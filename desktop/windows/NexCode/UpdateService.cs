using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace NexCode.Desktop
{
    internal sealed class UpdateRelease
    {
        internal string Version { get; set; }
        internal string InstallerUrl { get; set; }
        internal string ChecksumUrl { get; set; }
        internal string ManifestUrl { get; set; }
        internal string SignatureUrl { get; set; }
        internal long InstallerSize { get; set; }
    }

    internal sealed class UpdateService
    {
        internal const string InstallerAssetName = "Windows-Ota-Updata.exe";
        internal const string ChecksumAssetName = "Windows-Ota-Updata.exe.sha256";
        internal const string ManifestAssetName = "Windows-Ota-Updata.json";
        internal const string SignatureAssetName = "Windows-Ota-Updata.sig";
        private const string LatestReleaseApi = "https://api.github.com/repos/jasonlee539/NexCode/releases/latest";
        private const string PublicKeyResourceName = "NexCode.Desktop.UpdateSigningPublicKey.xml";
        private const long MaximumInstallerBytes = 1024L * 1024L * 1024L;
        private const int MaximumMetadataBytes = 64 * 1024;
        private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 };

        internal string CurrentVersion
        {
            get
            {
                string packagePath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "runtime", "package.json");
                try
                {
                    Dictionary<string, object> package = json.DeserializeObject(File.ReadAllText(packagePath)) as Dictionary<string, object>;
                    string version = JsonString(package, "version");
                    return string.IsNullOrWhiteSpace(version) ? "0.0.0" : version;
                }
                catch
                {
                    return "0.0.0";
                }
            }
        }

        internal bool IsInstalled
        {
            get
            {
                return File.Exists(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "NexCodeInstaller.exe"));
            }
        }

        internal async Task<UpdateRelease> CheckForUpdateAsync()
        {
            using (HttpClient client = CreateClient())
            using (HttpResponseMessage response = await client.GetAsync(LatestReleaseApi))
            {
                response.EnsureSuccessStatusCode();
                string body = await response.Content.ReadAsStringAsync();
                Dictionary<string, object> release = json.DeserializeObject(body) as Dictionary<string, object>;
                if (release == null || JsonBoolean(release, "draft") || JsonBoolean(release, "prerelease"))
                {
                    throw new InvalidDataException("GitHub 返回的最新版本信息无效。");
                }

                string tag = JsonString(release, "tag_name");
                string version = string.IsNullOrWhiteSpace(tag) ? null : tag.TrimStart('v', 'V');
                if (string.IsNullOrWhiteSpace(version) || CompareVersions(version, CurrentVersion) <= 0)
                {
                    return null;
                }

                object assetsValue;
                object[] assets = release.TryGetValue("assets", out assetsValue) ? assetsValue as object[] : null;
                if (assets == null) throw new InvalidDataException("GitHub Release 缺少 Windows OTA 资源。");

                string installerUrl = null;
                string checksumUrl = null;
                string manifestUrl = null;
                string signatureUrl = null;
                long installerSize = 0;
                foreach (object value in assets)
                {
                    Dictionary<string, object> asset = value as Dictionary<string, object>;
                    string name = JsonString(asset, "name");
                    if (string.Equals(name, InstallerAssetName, StringComparison.Ordinal))
                    {
                        installerUrl = ValidatedAssetUrl(JsonString(asset, "browser_download_url"));
                        installerSize = JsonInt64(asset, "size");
                    }
                    else if (string.Equals(name, ChecksumAssetName, StringComparison.Ordinal))
                    {
                        checksumUrl = ValidatedAssetUrl(JsonString(asset, "browser_download_url"));
                    }
                    else if (string.Equals(name, ManifestAssetName, StringComparison.Ordinal))
                    {
                        manifestUrl = ValidatedAssetUrl(JsonString(asset, "browser_download_url"));
                    }
                    else if (string.Equals(name, SignatureAssetName, StringComparison.Ordinal))
                    {
                        signatureUrl = ValidatedAssetUrl(JsonString(asset, "browser_download_url"));
                    }
                }

                if (string.IsNullOrEmpty(installerUrl)
                    || string.IsNullOrEmpty(checksumUrl)
                    || string.IsNullOrEmpty(manifestUrl)
                    || string.IsNullOrEmpty(signatureUrl))
                {
                    throw new InvalidDataException("GitHub Release 缺少 Windows OTA 更新包、清单或签名文件。");
                }
                if (installerSize <= 0 || installerSize > MaximumInstallerBytes)
                {
                    throw new InvalidDataException("Windows OTA 更新包大小无效。");
                }

                return new UpdateRelease
                {
                    Version = version,
                    InstallerUrl = installerUrl,
                    ChecksumUrl = checksumUrl,
                    ManifestUrl = manifestUrl,
                    SignatureUrl = signatureUrl,
                    InstallerSize = installerSize
                };
            }
        }

        internal async Task<string> DownloadInstallerAsync(UpdateRelease release)
        {
            if (release == null) throw new ArgumentNullException("release");
            string directory = Path.Combine(Path.GetTempPath(), "NexCode", "updates", Guid.NewGuid().ToString("N"));
            string installerPath = Path.Combine(directory, InstallerAssetName);
            Directory.CreateDirectory(directory);
            try
            {
                using (HttpClient client = CreateClient())
                {
                    byte[] manifestBytes = await DownloadMetadataAsync(client, release.ManifestUrl);
                    byte[] signatureBytes = await DownloadMetadataAsync(client, release.SignatureUrl);
                    Dictionary<string, object> manifest = VerifyAndParseManifest(manifestBytes, signatureBytes);
                    string manifestVersion = JsonString(manifest, "version");
                    string manifestFile = JsonString(manifest, "file");
                    string manifestHash = JsonString(manifest, "sha256");
                    long manifestSize = JsonInt64(manifest, "size");
                    if (!string.Equals(manifestVersion, release.Version, StringComparison.Ordinal)
                        || !string.Equals(manifestFile, InstallerAssetName, StringComparison.Ordinal)
                        || !Regex.IsMatch(manifestHash ?? "", "^[0-9a-f]{64}$", RegexOptions.CultureInvariant)
                        || manifestSize != release.InstallerSize)
                    {
                        throw new InvalidDataException("Windows OTA 签名清单与 GitHub Release 元数据不一致。");
                    }

                    string checksumText = await client.GetStringAsync(release.ChecksumUrl);
                    string expectedHash = ParseChecksum(checksumText);
                    if (!string.Equals(expectedHash, manifestHash, StringComparison.Ordinal))
                    {
                        throw new InvalidDataException("Windows OTA 校验文件与签名清单不一致。");
                    }
                    using (HttpResponseMessage response = await client.GetAsync(release.InstallerUrl, HttpCompletionOption.ResponseHeadersRead))
                    {
                        response.EnsureSuccessStatusCode();
                        long? contentLength = response.Content.Headers.ContentLength;
                        if (contentLength.HasValue && contentLength.Value != release.InstallerSize)
                        {
                            throw new InvalidDataException("Windows OTA 更新包长度与 Release 元数据不一致。");
                        }
                        if (contentLength.HasValue && contentLength.Value > MaximumInstallerBytes)
                        {
                            throw new InvalidDataException("Windows OTA 更新包超过大小限制。");
                        }
                        using (Stream input = await response.Content.ReadAsStreamAsync())
                        using (FileStream output = new FileStream(installerPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, true))
                        {
                            await CopyWithLimitAsync(input, output, release.InstallerSize);
                        }
                    }

                    FileInfo downloaded = new FileInfo(installerPath);
                    if (downloaded.Length != release.InstallerSize)
                    {
                        throw new InvalidDataException("Windows OTA 更新包下载不完整。");
                    }
                    string actualHash = Sha256(installerPath);
                    if (!string.Equals(actualHash, expectedHash, StringComparison.OrdinalIgnoreCase))
                    {
                        throw new InvalidDataException("Windows OTA 更新包 SHA-256 校验失败。");
                    }
                }
                return installerPath;
            }
            catch
            {
                try { if (Directory.Exists(directory)) Directory.Delete(directory, true); } catch { }
                throw;
            }
        }

        internal static int CompareVersions(string left, string right)
        {
            SemanticVersion leftVersion = SemanticVersion.Parse(left);
            SemanticVersion rightVersion = SemanticVersion.Parse(right);
            for (int index = 0; index < 3; index++)
            {
                int numeric = leftVersion.Numbers[index].CompareTo(rightVersion.Numbers[index]);
                if (numeric != 0) return numeric;
            }
            if (leftVersion.Prerelease == null && rightVersion.Prerelease == null) return 0;
            if (leftVersion.Prerelease == null) return 1;
            if (rightVersion.Prerelease == null) return -1;
            return ComparePrerelease(leftVersion.Prerelease, rightVersion.Prerelease);
        }

        private static int ComparePrerelease(string left, string right)
        {
            string[] leftParts = left.Split('.');
            string[] rightParts = right.Split('.');
            int length = Math.Max(leftParts.Length, rightParts.Length);
            for (int index = 0; index < length; index++)
            {
                if (index >= leftParts.Length) return -1;
                if (index >= rightParts.Length) return 1;
                int leftNumber;
                int rightNumber;
                bool leftNumeric = int.TryParse(leftParts[index], out leftNumber);
                bool rightNumeric = int.TryParse(rightParts[index], out rightNumber);
                int comparison;
                if (leftNumeric && rightNumeric) comparison = leftNumber.CompareTo(rightNumber);
                else if (leftNumeric) comparison = -1;
                else if (rightNumeric) comparison = 1;
                else comparison = string.Compare(leftParts[index], rightParts[index], StringComparison.OrdinalIgnoreCase);
                if (comparison != 0) return comparison;
            }
            return 0;
        }

        private static HttpClient CreateClient()
        {
            HttpClient client = new HttpClient();
            client.Timeout = TimeSpan.FromMinutes(5);
            client.DefaultRequestHeaders.UserAgent.ParseAdd("NexCode-Windows-Updater/1.0");
            client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
            return client;
        }

        private static async Task CopyWithLimitAsync(Stream input, Stream output, long expectedBytes)
        {
            byte[] buffer = new byte[81920];
            long total = 0;
            while (true)
            {
                int read = await input.ReadAsync(buffer, 0, buffer.Length);
                if (read == 0) break;
                total += read;
                if (total > expectedBytes || total > MaximumInstallerBytes)
                {
                    throw new InvalidDataException("Windows OTA 更新包超过 Release 声明的大小。");
                }
                await output.WriteAsync(buffer, 0, read);
            }
            if (total != expectedBytes)
            {
                throw new InvalidDataException("Windows OTA 更新包下载不完整。");
            }
        }

        private static async Task<byte[]> DownloadMetadataAsync(HttpClient client, string url)
        {
            using (HttpResponseMessage response = await client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead))
            {
                response.EnsureSuccessStatusCode();
                long? contentLength = response.Content.Headers.ContentLength;
                if (contentLength.HasValue && (contentLength.Value <= 0 || contentLength.Value > MaximumMetadataBytes))
                {
                    throw new InvalidDataException("Windows OTA 元数据大小无效。");
                }

                using (Stream input = await response.Content.ReadAsStreamAsync())
                using (MemoryStream output = new MemoryStream())
                {
                    byte[] buffer = new byte[4096];
                    while (true)
                    {
                        int read = await input.ReadAsync(buffer, 0, buffer.Length);
                        if (read == 0) break;
                        if (output.Length + read > MaximumMetadataBytes)
                        {
                            throw new InvalidDataException("Windows OTA 元数据超过大小限制。");
                        }
                        await output.WriteAsync(buffer, 0, read);
                    }
                    if (output.Length == 0) throw new InvalidDataException("Windows OTA 元数据为空。");
                    return output.ToArray();
                }
            }
        }

        private Dictionary<string, object> VerifyAndParseManifest(byte[] manifestBytes, byte[] signatureBytes)
        {
            string encodedSignature = Encoding.ASCII.GetString(signatureBytes).Trim();
            byte[] signature;
            try
            {
                signature = Convert.FromBase64String(encodedSignature);
            }
            catch (FormatException error)
            {
                throw new InvalidDataException("Windows OTA 签名格式无效。", error);
            }

            bool valid;
            using (RSACryptoServiceProvider rsa = new RSACryptoServiceProvider())
            using (SHA256 sha = SHA256.Create())
            {
                rsa.PersistKeyInCsp = false;
                rsa.FromXmlString(ReadSigningPublicKey());
                valid = rsa.VerifyData(manifestBytes, sha, signature);
            }
            if (!valid) throw new InvalidDataException("Windows OTA 数字签名验证失败。");

            Dictionary<string, object> manifest;
            try
            {
                manifest = json.DeserializeObject(Encoding.UTF8.GetString(manifestBytes)) as Dictionary<string, object>;
            }
            catch (ArgumentException error)
            {
                throw new InvalidDataException("Windows OTA 签名清单格式无效。", error);
            }
            if (manifest == null) throw new InvalidDataException("Windows OTA 签名清单格式无效。");
            return manifest;
        }

        private static string ReadSigningPublicKey()
        {
            using (Stream stream = typeof(UpdateService).Assembly.GetManifestResourceStream(PublicKeyResourceName))
            {
                if (stream == null) throw new InvalidDataException("Windows OTA 公钥资源缺失。");
                using (StreamReader reader = new StreamReader(stream, Encoding.UTF8, true))
                {
                    return reader.ReadToEnd();
                }
            }
        }

        private static string ValidatedAssetUrl(string value)
        {
            Uri uri;
            if (!Uri.TryCreate(value, UriKind.Absolute, out uri)
                || !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
                || !string.Equals(uri.Host, "github.com", StringComparison.OrdinalIgnoreCase)
                || !uri.AbsolutePath.StartsWith("/jasonlee539/NexCode/releases/download/", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException("GitHub Release 返回了无效的 Windows OTA 下载地址。");
            }
            return uri.AbsoluteUri;
        }

        private static string ParseChecksum(string value)
        {
            Match match = Regex.Match(
                value ?? "",
                "^([0-9a-fA-F]{64})\\s+\\*?Windows-Ota-Updata\\.exe\\s*$",
                RegexOptions.Multiline | RegexOptions.CultureInvariant);
            if (!match.Success) throw new InvalidDataException("Windows OTA 校验文件格式无效。");
            return match.Groups[1].Value.ToLowerInvariant();
        }

        private static string Sha256(string path)
        {
            using (FileStream stream = File.OpenRead(path))
            using (SHA256 sha = SHA256.Create())
            {
                byte[] digest = sha.ComputeHash(stream);
                StringBuilder builder = new StringBuilder(digest.Length * 2);
                foreach (byte value in digest) builder.Append(value.ToString("x2"));
                return builder.ToString();
            }
        }

        private static string JsonString(Dictionary<string, object> value, string key)
        {
            if (value == null) return null;
            object result;
            return value.TryGetValue(key, out result) ? result as string : null;
        }

        private static bool JsonBoolean(Dictionary<string, object> value, string key)
        {
            if (value == null) return false;
            object result;
            return value.TryGetValue(key, out result) && result is bool && (bool)result;
        }

        private static long JsonInt64(Dictionary<string, object> value, string key)
        {
            if (value == null) return 0;
            object result;
            if (!value.TryGetValue(key, out result) || result == null) return 0;
            try { return Convert.ToInt64(result); }
            catch { return 0; }
        }

        private sealed class SemanticVersion
        {
            internal int[] Numbers { get; private set; }
            internal string Prerelease { get; private set; }

            internal static SemanticVersion Parse(string value)
            {
                if (string.IsNullOrWhiteSpace(value)) throw new FormatException("版本号为空。");
                string normalized = value.Trim().TrimStart('v', 'V');
                int metadataAt = normalized.IndexOf('+');
                if (metadataAt >= 0) normalized = normalized.Substring(0, metadataAt);
                string prerelease = null;
                int prereleaseAt = normalized.IndexOf('-');
                if (prereleaseAt >= 0)
                {
                    prerelease = normalized.Substring(prereleaseAt + 1);
                    normalized = normalized.Substring(0, prereleaseAt);
                }
                string[] fields = normalized.Split('.');
                if (fields.Length != 3 || string.IsNullOrWhiteSpace(prerelease) && prereleaseAt >= 0)
                {
                    throw new FormatException("版本号不是有效的语义化版本。");
                }
                int[] numbers = new int[3];
                for (int index = 0; index < numbers.Length; index++)
                {
                    if (!int.TryParse(fields[index], out numbers[index]) || numbers[index] < 0)
                    {
                        throw new FormatException("版本号不是有效的语义化版本。");
                    }
                }
                return new SemanticVersion { Numbers = numbers, Prerelease = prerelease };
            }
        }
    }
}

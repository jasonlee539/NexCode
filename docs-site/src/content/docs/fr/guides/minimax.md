---
title: Clients MiniMax
description: Routez les commandes textuelles de MiniMax Code et MiniMax CLI par NexCode sans exposer les identifiants MiniMax.
---

MiniMax publie deux produits distincts en ligne de commande. NexCode intègre chacun à la frontière du protocole qu’il expose réellement :

- **MiniMax Code** (`mcode`) est un agent de programmation prenant en charge les fournisseurs Anthropic Messages personnalisés.
- **MiniMax CLI** (`mmx`) est un CLI de plateforme multimodale. Seule sa ressource `text` utilise l’API compatible avec Anthropic qu’NexCode peut router.

## MiniMax Code

Installez MiniMax Code et connectez-vous d’abord en suivant les instructions de MiniMax. Démarrez ensuite NexCode et activez l’intégration de fichier réversible :

```bash
nxc start
nxc integration client enable --client mcode
nxc mcode
```

![Intégration MiniMax Code avec des données d’exemple isolées](/screenshots/minimax-code-integration.png)

L’intégration fusionne un bloc dans `~/.minimax/config.yaml` :

```yaml
custom_provider:
  nexcode:
    name: NexCode
    kind: custom
    enabled: true
    api: anthropic-messages
    options:
      apiKey: nexcode-loopback
      baseURL: http://127.0.0.1:10100
      authMode: api-key
    models:
      anthropic/claude-opus-5:
        limit:
          context: 1000000
```

La liste de modèles réellement générée, ainsi que les fenêtres de contexte et les niveaux d’effort de raisonnement connus, provient du catalogue NexCode actif. Lorsqu’aucune fenêtre de contexte ou échelle d’effort ne fait autorité pour un modèle, le champ correspondant est omis au lieu de recevoir une valeur supposée. MCode conserve l’effort actuellement sélectionné dans la session : NexCode exporte donc `effortOptions` sans remplacer cette sélection. Le bloc n’écrit aucune clé réelle, ne remplace pas `defaultModel` et ne modifie pas votre connexion MiniMax. Dans MCode, choisissez un modèle sous `custom_provider:nexcode/...`.

`nxc mcode` vérifie que ce fournisseur pointe vers le proxy actuellement actif avant de lancer le client. Après l’activation initiale, `nxc sync` actualise le bloc géré lorsque le port ou les capacités du catalogue changent. La synchronisation automatique ne crée jamais un bloc non géré, ne recrée pas un bloc que vous avez supprimé et n’écrase pas un fichier modifié après l’écriture d’NexCode ; utilisez la commande d’activation lorsque vous souhaitez le reconnecter explicitement. Désactivez-le ou restaurez-le au moyen du même système d’intégration audité :

```bash
nxc integration client disable --client mcode
nxc integration client history --client mcode
nxc integration client restore --op <opId> [--confirm-drift]
```

`MINIMAX_DATA_DIR` et l’ancienne variable `MAVIS_DATA_DIR` sont prises en charge. Les chemins relatifs sont refusés, car NexCode et MCode peuvent démarrer depuis des répertoires de travail différents.

## MiniMax CLI (`mmx`)

Installez séparément le CLI officiel :

```bash
npm install -g mmx-cli
mmx --version
```

Routez une commande textuelle par NexCode en utilisant l’enveloppe et un identifiant de modèle NexCode :

```bash
nxc mmx text chat \
  --model anthropic/claude-opus-5 \
  --message "Explain this function"

nxc mmx --output json text chat \
  --model openai/gpt-5.6-sol \
  --message "Return a JSON summary"
```

MMX ajoute systématiquement `/anthropic/v1/messages` à son URL de base d’API. L’enveloppe démarre un pont local temporaire pendant la durée du processus enfant. Celui-ci accepte uniquement les requêtes POST vers ce chemin Messages et vers `/anthropic/v1/messages/count_tokens`, puis les associe aux plans de données `/v1/messages` et `/v1/messages/count_tokens` existants d’NexCode tout en préservant le corps et les paramètres des requêtes. La traduction canonique des requêtes NexCode, le suivi de l’utilisation et l’authentification configurée des fournisseurs en aval restent actifs ; les fournisseurs reçoivent `x-api-key` ou un jeton porteur selon leur configuration. La diffusion conserve les événements Anthropic de message et de contenu. Avant le transfert, le pont retire les en-têtes d’identification d’admission entrants et fixe la valeur publique temporaire `nexcode-loopback`. Aucune autre ressource Anthropic n’est transmise et le pont n’est jamais exposé au-delà de l’adresse locale.

L’enveloppe crée également un `MMX_CONFIG_DIR` temporaire qui ne contient que cette valeur publique, puis le supprime à la fermeture de `mmx`. Votre fichier `~/.mmx/config.json`, vos jetons OAuth et votre clé d’API MiniMax ne sont jamais chargés ni copiés.

Les limites suivantes sont intentionnelles :

- Seules les commandes `text chat` et `text repl` sont routées par NexCode.
- L’enveloppe refuse `--api-key`, `--base-url` et `--region` afin que les identifiants ou les destinations fournis par l’appelant n’entrent pas en conflit avec le pont isolé.
- Le pont est limité à l’adresse locale, car MMX ne peut pas envoyer l’en-tête d’admission dédié `x-nexcode-api-key` d’NexCode pour une liaison distante.
- Utilisez directement `mmx` pour `image`, `video`, `speech`, `music`, `vision`, `search`, `quota`, `auth`, `config`, `file` et `update` ; ces ressources appellent des API propres à MiniMax qu’NexCode n’émule pas.

Le modèle textuel par défaut de `mmx` est `MiniMax-M3`. Fournissez `--model <provider/model>` pour cibler une route NexCode précise ; sinon, les règles normales de routage des modèles NexCode déterminent si l’identifiant par défaut est disponible.

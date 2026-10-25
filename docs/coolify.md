# Installer sur Coolify

Guide pas à pas pour héberger l'instance « Jellyfin en boucle » dans un container Coolify, avec le [Dockerfile](../Dockerfile) du dépôt. Retour au [README](../README.md).

Les noms de menu peuvent varier un peu selon la version de Coolify. L'image n'a pas été construite ni essayée sur un vrai Coolify au moment d'écrire ce guide (Docker absent du PC de développement).

## Avant de commencer

- Le code doit être sur le dépôt Git que Coolify va cloner (`git push`).
- Il faut l'adresse IP du serveur Coolify et l'URL de Jellyfin (par exemple `http://192.168.1.10:8096`).
- L'application n'a **aucune authentification** : qui atteint son URL pilote la lecture et voit la bibliothèque Jellyfin. Elle doit rester sur le réseau local.

## Installation

1. **Nouvelle ressource.** Projects → le projet → l'environnement → **+ New Resource**. Choisir **Public Repository** si le dépôt GitHub est public, sinon **Private Repository** (GitHub App ou deploy key). Renseigner l'URL du dépôt et la branche `main`.
2. **Build pack.** Choisir **Dockerfile** (pas Nixpacks). Base Directory `/`, Dockerfile Location `/Dockerfile`.
3. **Configuration → General.**
   - Ports Exposes : `8787`
   - Ports Mappings : `8787:8787`
   - Domains : **laisser vide**. Un domaine passerait par le proxy Traefik de Coolify et rendrait l'application joignable hors du réseau local, sans authentification.
4. **Environment Variables.**

   | Variable | Valeur | Pourquoi |
   |---|---|---|
   | `JELLYFIN_URL` | `http://<ip-jellyfin>:8096` | la découverte automatique ne traverse pas le réseau de Docker |
   | `PUBLIC_URL` | `http://<ip-serveur-coolify>:8787/` | sans elle, le QR code affiche l'adresse interne du container |

5. **Persistent Storage → Add.** Type Volume, Destination Path `/data`. Il contient la configuration, le jeton Jellyfin et `state.json` (file, historique, reprise). Sans lui, tout est perdu à chaque déploiement.
6. **Deploy.** Suivre les logs de build. Quand le container est `healthy`, ouvrir `http://<ip-serveur-coolify>:8787/` et suivre l'assistant (connexion à Jellyfin, choix de la série).

Si le port 8787 est déjà pris sur le serveur, changer le côté gauche du mapping (par exemple `8788:8787`) et adapter `PUBLIC_URL`.

## Ajouter un écran de lecture

Le container pilote les écrans à distance : un nouveau PC n'a besoin que de Jellyfin MPV Shim, pas de l'application. Dans l'interface, Réglages → **Ajouter un écran** affiche la commande à coller sur le nouveau PC (avec l'adresse du serveur déjà remplie) :

```
Windows (PowerShell)   irm http://<ip-serveur-coolify>:8787/lecteur.ps1 | iex
Linux                  curl -fsSL http://<ip-serveur-coolify>:8787/lecteur.sh | bash
```

Elle installe MPV Shim s'il manque (Windows : installeur GitHub en silencieux ; Linux : AUR, sinon Flatpak, sinon pipx), le fait démarrer à l'ouverture de session et le lance. Rien d'autre n'est installé. Il reste à ouvrir MPV Shim, y ajouter le serveur Jellyfin avec **le même utilisateur** que l'application, puis choisir l'écran dans « Lire sur… ».

Pour une télé, installer l'appli Jellyfin et s'y connecter avec le même compte : aucune commande.

Pour retirer un écran : désinstaller MPV Shim (Windows : Applications installées ; Linux : le paquet AUR, `flatpak uninstall com.github.iwalton3.jellyfin-mpv-shim` ou `pipx uninstall jellyfin-mpv-shim`), puis supprimer le raccourci du dossier Démarrage (Windows) ou `~/.config/autostart/jellyfin-mpv-shim.desktop` (Linux). N'utilise pas `deploy/*/install.*` pour un simple écran : il installe aussi une seconde instance de l'application.

Ces scripts n'ont pas été lancés sur un PC neuf au moment de les écrire : seule leur syntaxe a été vérifiée.

## Mises à jour

Coolify reconstruit l'image à chaque déploiement. Pour redéployer à chaque push sur `main`, activer **Auto Deploy** (Advanced). Le volume `/data` garde la configuration d'un déploiement à l'autre.

La mise à jour git de l'application (Réglages) n'existe pas dans le container : elle y affiche « indisponible ».

## Ce qui disparaît de l'interface

Le compresseur audio, la sortie audio et l'anti-veille concernent le PC qui héberge l'instance. Dans un container, ils sont masqués ou grisés. Un `mpv.conf` déjà réglé sur un PC reste actif.

## Passer d'un PC au container

Une seule instance doit piloter un écran : rien n'empêche d'en lancer deux, mais elles se disputeraient le même lecteur.

1. Copier `state.json` du PC (dossier de configuration : `~/.config/jellyfin-office` sous Linux, `%APPDATA%\jellyfin-office` sous Windows) dans le volume `/data` du container.
2. Désinstaller l'application du PC en gardant MPV Shim : `deploy/linux/uninstall.sh --keep-third-party` ou `deploy\windows\uninstall.ps1 -KeepThirdParty`. Ne pas copier `token` : la désinstallation le révoque côté Jellyfin.
3. Démarrer le container et refaire l'assistant, puis connecter MPV Shim du PC au même utilisateur Jellyfin.

## En cas de problème

| Symptôme | À vérifier |
|---|---|
| le build échoue | la dernière ligne du log de build ; Build Pack bien sur **Dockerfile** |
| la page ne s'ouvre pas | le mapping de port, le pare-feu du serveur, et qu'aucun domaine n'est configuré |
| le QR code montre une adresse en `172.x` | `PUBLIC_URL` manquante |
| l'assistant ne trouve pas Jellyfin | `JELLYFIN_URL` manquante ou injoignable depuis le serveur |
| la configuration disparaît à chaque déploiement | volume persistant absent sur `/data` |
| « Lire sur… » ne liste pas un écran | l'écran doit être ouvert et connecté au même utilisateur Jellyfin |

Journal : onglet **Logs** de l'application dans Coolify (ou `docker logs -f <container>` sur le serveur).

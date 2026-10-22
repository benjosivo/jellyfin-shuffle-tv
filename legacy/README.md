# Ancien fonctionnement (référence)

Cette application remplace deux anciens scripts personnels, qui ne sont pas reproduits ici :

- `auth.py` : générait `~/.config/jellyfin-office/token` et `user_id`. Il est remplacé par l'assistant de configuration de l'interface web. Un token déjà créé par ce script est conservé s'il reste valide sur le serveur choisi dans l'assistant.
- `the-office-random.fish` : la boucle de lecture d'origine, remplacée par le service `jellyfin-office`. Son comportement est repris dans `src/player/loop.ts` (voir les commentaires en tête de fichier), avec les corrections décrites dans le README principal.

À ne plus lancer : les deux pilotent MPV Shim et se gêneraient.

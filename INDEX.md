# carnet-muscu — INDEX

> Dernière analyse : 2026-09-17

Carnet de musculation personnel de Mehdi, en PWA installable sur iPhone, sauvegardé dans une feuille Google Sheets via un script Apps Script. HTML/CSS/JS vanilla, sans framework, hébergé sur GitHub Pages (gratuit).

- Site : https://mehdioptimisationtrash-cyber.github.io/carnet-muscu/
- Repo : https://github.com/mehdioptimisationtrash-cyber/carnet-muscu

## Architecture & fichiers clés

| Fichier | Rôle |
|---|---|
| `index.html` | page unique (en-tête niveau/XP, état de sauvegarde, onglets Séance / Stats, barre de séance, overlay) |
| `styles.css` | look façon Notion + pastilles de séries, thème clair/sombre |
| `app.js` | logique : modèle `state` (v2), progression par série (double progression 10→15 reps puis +cran de charge), séance (démarrer / valider série / repos / terminer), XP-niveaux-badges, stats & axes d'amélioration, export/import JSON, démarrage avec fusion cache ↔ feuille |
| `sync.js` | couche Google Sheets : `load()` (GET), `scheduleSave()` (POST regroupé 1 s), file d'attente hors-ligne (`localStorage` drapeau `carnet-muscu-outbox`), reprise sur `online` / `visibilitychange` |
| `config.js` | `SHEETS_URL` (URL Apps Script `/exec`) + `TOKEN` — **visibles publiquement**, seule protection = le script ne touche que cette feuille |
| `sw.js` | service worker : cache des fichiers statiques (réseau d'abord pour les pages), jamais les appels Google ; bump `CACHE_VERSION` à chaque déploiement |
| `manifest.webmanifest`, `icons/` | PWA (`standalone`, icônes 192/512/apple-touch 180 générées depuis 🏋️) |
| `apps-script/Code.gs` | script Google à coller dans la feuille : `doGet` renvoie l'état, `doPost` l'écrit (onglets `state`, `historique`, `exercices`) |
| `tools/make-icons.py` | régénère les icônes (Playwright) |
| `tools/e2e_local.py` | test de bout en bout local (feuille Google simulée par interception) |
| `exports/` (gitignoré) | `migration.json` = données issues de l'ancien fichier iCloud (12 exos, séance du 15/09) |

## Modèle de données (`state` v2)
`{ v:2, rev, xp, settings:{rest}, exos:[{id,name,mode:'reps'|'temps',step,repMin,repMax,sets:[{charge,reps}],last,best,stalled}], session:null|{startedAt,results}, history:[{date,at,min,volume,xp,setsDone,setsTotal,fails,prs,paliers,exos}] }`
- La version la plus récente (`rev`) gagne entre cache local et feuille.
- Exercices non touchés pendant une séance = réservés à une autre séance : ni pénalité ni modification.

## Comment lancer
```bash
python3 -m http.server 8000     # http://localhost:8000
python3 tools/e2e_local.py       # test complet (serveur lancé)
```
Déploiement : `git push` (Pages sur `main`, racine). Penser à `CACHE_VERSION` dans `sw.js`.

## Historique
- Version 1 (2026-09-17) : artifact claude.ai `DttEKNHwZtuTbivv21c6BB` (modèle simple charge/reps/séries, mémoire partagée) — obsolète.
- Version 2 (2026-09-17) : fichier HTML auto-réécrit dans iCloud Drive (`~/Library/Mobile Documents/com~apple~CloudDocs/Documents/Carnet Muscu/Carnet Muscu.html`) — figé, contient la séance du 15/09.
- Version 3 (2026-09-17) : ce projet (PWA + Google Sheets + GitHub Pages).

## Activité récente
- 2026-09-17 : création du projet, premier commit, repo GitHub + Pages.

## TODO
- [ ] Mehdi : créer la feuille Google + déployer `Code.gs` (README §1), me donner l'URL `/exec`.
- [ ] Renseigner `SHEETS_URL` dans `config.js`, pousser, puis migrer `exports/migration.json` dans la feuille (POST curl).
- [ ] Installer sur l'iPhone (Safari → Partager → Sur l'écran d'accueil) et tester une séance réelle.
- [ ] Éventuel : réglage du temps de repos dans l'interface (aujourd'hui 90 s fixe dans `settings.rest`).

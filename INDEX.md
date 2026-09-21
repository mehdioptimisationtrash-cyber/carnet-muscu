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
`{ v:2, rev, xp, settings:{rest,weeklyGoal,autoDeload}, exos:[{id,name,mode:'reps'|'temps',step,repMin,repMax,sets:[{charge,reps,fails}],last,best,stalled}], session:null|{startedAt,results,targets,light}, history:[{date,at,min,volume,xp,setsDone,setsTotal,fails,prs,paliers,light,challenges:{total,won},exos}], weights:[{date,kg}] }`
- La version la plus récente (`rev`) gagne entre cache local et feuille.
- Exercices non touchés pendant une séance = réservés à une autre séance : ni pénalité ni modification.

## Logique de coaching (décisions 2026-09-17)
- **Défi** = série dont la cible dépasse la dernière fois (ou défi raté à retenter) → pastille ⚡, ligne « Défi : S1 +1 rep », écran de départ « N défis, jusqu'à +XP », bilan « défis x/y ».
- **Échec** : en séance, bouton « Trop lourd : valider et alléger la suite (−cran) » (modifie `session.targets`, persiste comme nouvelle base) ; en fin de séance, par exo raté : Retenter / Alléger −cran / Garder ce que j'ai fait ; automatique : raté 2× de suite (`sets[i].fails`) → −1 cran (`settings.autoDeload`).
- **Séance légère** : charges −10 % arrondies au cran (min. −1 cran), aucun défi, cibles et `last` inchangés, XP ÷ 2, entrée d'historique `light`.
- **Poids corporel** (onglet Stats) : moyenne 7 j, rythme %/semaine avec message (idéal −0,5 à −1 %/sem ; Mehdi 187 cm / 112 kg en recomposition).
- Objectif séances/semaine (chip 📅 x/y), repos réglable, semaine de décharge conseillée si ≥ 3 exos stagnent.
- **Pile de plaques** (`exo.stack: number[]`, saisie dans ⋯ → « Plaques de la machine ») : les machines de la salle sont de vieilles Technogym, les crans ne sont pas de 2 kg. Si `stack` existe : options de charge = plaques, palier = plaque suivante (`nextCharge`), allègement/recalibrage/séance légère = plaque précédente (`prevCharge`). Sinon `step` (haltères/barre). Si la plaque suivante > +10 %, conseil « palier à 20 reps ».

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
- 2026-09-17 : feuille Google créée par Mehdi, script déployé (id `AKfycbwWdy99…u8Z0`), `SHEETS_URL` branchée dans `config.js`, données migrées dans la feuille (12 exos, séance du 15/09, 700 XP), vérifié en navigateur : lecture + écriture OK.

- 2026-09-17 (soir) : Leg press = fusion de « Legs · ischio » + « Legs · normal » (écrit directement dans la feuille). Ajout défis explicites, gestion des échecs, séance légère, objectif hebdo, poids corporel, réglages ⚙︎ (cache SW v3).
- 2026-09-18 : pile de plaques par machine (SW v4). Corrigé 3 bugs remontés par Mehdi : (1) exo ajouté pendant une séance en cours n'avait pas d'entrée dans `session.results`/`targets` → tap ne faisait rien (`openSet` plantait sur `results[exoId][i]` undefined) ; (2) saisir la pile de plaques ne recalait pas les charges déjà choisies sur les vraies valeurs (pas de snap) ; (3) une séance coupée puis reprise le même jour créait une 2e entrée d'historique → comptait double dans « x/3 cette semaine ». Corrigé aussi 2 doublons déjà présents dans la feuille (18/09, 180+185 XP → fusionnés 315 XP). SW v5.

## Notes techniques
- Un POST vers Apps Script répond par une redirection 302 vers `script.googleusercontent.com/macros/echo` : les navigateurs la suivent et lisent bien `{"ok":true}`. Python `urllib` la suit mal (renvoie `unauthorized` alors que l'écriture a eu lieu) — utiliser Playwright pour tester, pas `curl`/`urllib`.
- `curl` est refusé par les permissions de la session Claude Code chez Mehdi.

## Cardio & pont Apple Watch (2026-09-21)
- **Cardio chronométré** avant et/ou après la muscu : choisi dans l'écran de départ (`#scAvant`/`#scApres`, mémorisé dans `settings.cardio`), ou ajouté à la volée (« + Cardio avant/après »). État : `session.cardio = { avant|apres: {type, startedAt, sec, done} | null }` — le chrono se calcule depuis `startedAt` (survit à la mise en veille). « Corriger » pour rectifier la durée. Historique : `entry.cardio = [{pos,type,sec}]` ; XP = 2/min (plafond 60 par bloc) ; séance « cardio seul » possible. Stats : tuile « Cardio cette semaine x/150 min » + axe d'amélioration (repère OMS 150 min, cardio après la muscu).
- **Apple Watch** : une app web n'a pas accès à HealthKit → on passe par l'app **Raccourcis** (`shortcuts://run-shortcut?name=…`, fonction `runShortcut`, activable dans ⚙︎ `settings.apple`). Raccourcis attendus (noms exacts, constante `SHORTCUTS`) : `Muscu Renfo`, `Muscu Elliptique`, `Muscu Marche`, `Muscu Vélo`, `Muscu Rameur`, `Muscu Course`, `Muscu Fin` — chacun = « Démarrer l'exercice » + « Ouvrir l'app Muscu ». Ordre : départ sans cardio avant → Renfo ; cardio Démarrer → type ; fin du cardio avant → Renfo ; Terminer/Annuler → Fin. Test : `window.__shortcutLog` (couture de test, `tools/e2e_cardio.py`).

## Journal & nutrition (2026-09-21, validé par Mehdi) — `nutrition.js`
- **Onglet Journal** : bandeau calendrier 7 jours (‹ › pour changer de semaine ; couleur = respect des objectifs, 🏋️ = séance, 🍺 = alcool), jauges calories/protéines, repas par créneau (`pdj`, `dej`, `din`, `col`, `boi`), note du jour, rappel séance/pesée du jour, **pesée** (déplacée ici depuis Stats, enregistrée pour le jour sélectionné).
- **Saisie à deux vitesses** : *Rapide* = taille du repas (léger ×0,6 / normal / copieux ×1,4 / très copieux ×1,9 du « repas type » `settings.nutri.base`) + part de protéines (0/12/30/45 g) → estimation marquée `est` (≈) ; collations et boissons par type en un tap, **alcool compté en verres standard** (`meal.alc`). *Précise* = Favoris (`settings.nutri.favs`), Recherche Open Food Facts (texte, quantité en g), Libre.
- **Objectifs** : `computeTargets` (Mifflin-St Jeor × activité, −20 % ; protéines = 2 g/kg du poids à IMC 25). Profil de Mehdi (36 ans, 187 cm, 112 kg, activité 1,4) → **2 350 kcal / 175 g**, écrit dans la feuille (`settings.nutri.profile`), jamais dans le code public.
- **Données** : `state.nutrition = { 'AAAA-MM-JJ': { date, meals:[{id,slot,label,kcal,p,alc,size?,prot?,est?,at}], note, xp:{logged,prot} } }`. XP : +15 journée complète (3 repas), +15 protéines atteintes (une seule fois par jour).
- **Synchro** : la nutrition ne voyage **pas** dans `state` (cellule limitée à 50 000 caractères) : `Sync.markDay(date)` → le POST envoie `{state (sans nutrition), days:{date: jour}}` pour les seuls jours modifiés ; `Code.gs` **v2** les range dans l'onglet `nutrition` (1 ligne/jour, lisible + JSON) et renvoie les 120 derniers jours au GET. Avec un script v1, les jours restent « à envoyer » (bandeau d'avertissement dans le Journal) et partent dès la mise à jour.
- **Stats** : bloc poids (tuiles + courbe), bloc « Nutrition — 7 jours » (moyennes, jours protéines OK, alcool, repas copieux, barres 14 jours vs objectif) ; axes : protéines basses, alcool ≥ 4 verres, ≥ 4 repas copieux, poids stable malgré calories « dans la cible » (sous-déclaration probable), perte trop rapide, journal troué.
- `app.js` expose `window.App` (passerelle : state, commit, el, openSheet, tile, ax…) ; `today()` est maintenant en date **locale**.
- Attention CSS : ne pas nommer un état `empty` (collision avec `.empty`) → états du calendrier préfixés `st-`.

## Logique anti-doublon (2026-09-18)
- `finishSession()` : si `state.history.at(-1).date === today()`, la nouvelle séance **fusionne** avec la précédente (`mergeEntries`) au lieu de créer une 2e entrée — additionne sets/volume/xp/défis, union prs/paliers, `exos` = dernière valeur par id, `light` = ET des deux. Pas de bonus `XP.session` ni de bonus de série sur une reprise (`continuation`).
- `weekCount()`/les chips comptent des **entrées d'historique**, donc dépendent de cette dédup par date — ne pas la retirer sans revoir ces compteurs.

- 2026-09-19 : 3 autres bugs corrigés (édition de cible hors séance) : (1) une série dont la cible montait n'était jamais mise en doré — `.chal` n'avait qu'un liseré, maintenant fond `--gold-soft` plein ; (2) bouton « Appliquer à toutes les séries » supprimé — l'édition d'une cible est désormais **toujours** liée à une seule série (`Enregistrer la cible de la série N`) ; (3) relever la charge d'une série (dropdown `#fC`) fait maintenant repartir les reps à `e.repMin` automatiquement (ajustable ensuite), avec un indice affiché. `repMin` par défaut passé de 10 à 8 dans `mkExo`, et mis à jour à 8 pour tous les exos déjà en base (feuille + `data/seed`). SW v6.

## TODO
- [ ] Mehdi : recoller `apps-script/Code.gs` (v2) dans Apps Script + Déployer → Gérer les déploiements → ✏️ → Nouvelle version (sinon la nutrition reste sur le téléphone).
- [ ] Mehdi : créer les raccourcis iOS `Muscu Renfo/Elliptique/Marche/Fin` et activer ⚙︎ → Apple Watch.
- [ ] `app.js` fait ~830 lignes (limite 800) : extraire les stats dans `stats.js` à la prochaine évolution.
- [ ] Mehdi : installer sur l'iPhone (Safari → Partager → Sur l'écran d'accueil) et tester une séance réelle.
- [ ] Saisir les piles de plaques des machines de la salle (⋯ → « Plaques de la machine » sur chaque exo, ou me les dicter).
- [ ] Éventuel : réglage du temps de repos dans l'interface (aujourd'hui 90 s fixe dans `settings.rest`).

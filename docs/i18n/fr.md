# REA Pro Max

**Comprendre le mécanisme. Reconstruire le comportement. Vérifier le résultat.**

Une boîte à outils indépendante de rétro-ingénierie avec MCP local, skill d’agent et CLI directe pour Claude Code, Codex et clients MCP compatibles. Transformez une application, une extension ou une fonction web inconnue en un mécanisme explicable, une implémentation exécutable et un contrat de comportement fini que vous pouvez contrôler.

[English](../../README.md) · [Tiếng Việt](vi.md) · [한국어](ko.md) · [日本語](ja.md) · [Español](es.md) · [Português](pt-BR.md) · [简体中文](zh-CN.md) · [ไทย](th.md) · [Français](fr.md)

[Explorer le laboratoire enregistré](https://hieunguyenak92.github.io/rea-pro-max/#explorer) · [Installer la skill](../INSTALL.md) · [Dossier de vérification](../VALIDATION.md) · [Versions](https://github.com/hieunguyenak92/rea-pro-max/releases)

![REA Pro Max — Understand the mechanism](../media/hero.png)

![Workbench réel de REA Pro Max issu du laboratoire synthétique propre](../media/workbench.png)

*Rapport réel du modèle JavaScript avec API Chrome simulées ; il ne prouve pas le cycle de vie de Chromium réel.*

## Une sauvegarde qui résiste au vrai redémarrage du worker

Une démo dans une session active peut masquer une perte de données. La v0.3 crée un projet récepteur exécutable : le starter sauvegarde et passe la réouverture de page, puis perd la valeur confirmée lorsque Chromium arrête et réveille réellement le worker.

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs recovery init --out ./recovery-work
node skills/rea-pro-max/scripts/rea-pro-max.mjs runtime doctor --browser "$RPM_BROWSER"
node skills/rea-pro-max/scripts/rea-pro-max.mjs recovery replay --reference ./recovery-work/reference --candidate ./recovery-work/starter --scenario ./recovery-work/scenario.json --browser "$RPM_BROWSER" --out ./before.json
```

Définissez `RPM_BROWSER` comme le chemin absolu de l’exécutable installé Chromium/Chrome for Testing acceptant les extensions décompressées. Aucun navigateur n’est téléchargé automatiquement. Le premier replay renvoie volontairement exit `2`, identifie l’action divergente et conserve les deux exécutions. Demandez à l’agent de corriger `starter/worker.js` selon `starter/contract.json`, puis relancez avec une nouvelle sortie. `recovered/` est un exemple récepteur exécutable écrit indépendamment.

**Le livrable est du code exécutable et une preuve que vous pouvez examiner.** Ce fournisseur vérifie le protocole de messages documenté `rpm-kv-v1` et les frontières de reset choisies ; il ne reconstruit pas automatiquement toute extension. Les boot ID restent dans les données brutes ; seul ce champ d’observation déclaré est exclu de la comparaison. Les reçus de messages ne prouvent pas les effets UI, réseau ou fichiers non observés.

MCP propose **15 outils**. Le runtime est désactivé par défaut ; ajoutez `--browser "/absolute/path/to/chromium"` à l’enregistrement du serveur pour activer `capture_feature` et `replay_feature`. Ils utilisent des profils temporaires séparés ; l’agent de l’environnement écrit la correction. `read_source_evidence` lit des extraits bornés après contrôle du hash. include/exclude et coverage précisent les fichiers admis, omis et non analysés ; l’analyse sémantique TypeScript/JSX n’est pas encore fournie.

[Procédure et limites, en anglais](../RECOVERY.md) · [Vérification par version](../VALIDATION.md). `shrink` lance l’oracle dans un nouveau processus enfant à chaque essai, avec un délai. Sa fonction `reset()` gère l’état externe. Un profil neuf ou un processus enfant n’est pas un bac à sable système ou réseau.

## Une interface convaincante n’est qu’un début

La difficulté commence après le clic : quel contexte reçoit le message, où l’état persiste, ce que l’annulation interrompt, quelle erreur revient à l’appelant et pourquoi la fonction reconstruite échoue à la deuxième tentative.

REA Pro Max intègre ces questions au travail d’implémentation. Analysez le JavaScript distribué. Formulez des explications concurrentes. Choisissez une expérience qui les départage. Implémentez le comportement demandé dans votre projet. Comparez les sorties, les changements d’état et les événements observés. Réduisez un écart aux actions qui reproduisent toujours la même défaillance.

**Le livrable est la fonctionnalité opérationnelle demandée, accompagnée de preuves.** L’agent de votre environnement effectue le développement et les opérations d’exécution ; les outils fournis apportent des mécanismes exécutables d’analyse, de classement des expériences, de vérification et de réduction.

## Confiez une tâche, sans apprendre un nouveau processus

Après [installation](../INSTALL.md), demandez le travail dans Claude Code :

```text
/rea-pro-max Étudie comment cette extension enregistre et restaure les données, puis implémente ce comportement dans mon projet. Trace les frontières entre popup, content script, worker et stockage. Vérifie la persistance après un redémarrage confirmé du worker, conserve les erreurs et livre du code exécutable, les cas réellement testés et les points encore non vérifiés.
```

Dans Codex, sélectionnez la skill ou ajoutez `$rea-pro-max` au début de la même demande. Fournissez la cible et le projet destinataire ; l’agent prépare les fichiers internes du dossier. Observer un navigateur, une application ou un appareil réel nécessite les outils correspondants dans votre environnement.

- **Reconstruire une fonction précise :** ordre, erreurs, annulation et limites de persistance.
- **Comprendre une extension MV3 :** distinguer popup, content, page et worker.
- **Retrouver les frontières Electron :** analyser les sources extraites de main, preload et renderer.
- **Expliquer une régression entre builds :** comparer entrées compatibles et effets observables.
- **Réduire une défaillance reproductible :** raccourcir la séquence en conservant son identité.

## Une boîte à outils. Trois façons de commencer.

**La v0.3 fournit un MCP local de 15 outils**, la capture/replay optionnelle dans Chromium réel et des extraits de code dont le hash est vérifié. La skill conduit l’agent vers une implémentation exécutable ; la CLI partage le noyau sans installation npm à l’usage.

### Connecter MCP à Claude Code ou Codex

Remplacez les chemins absolus par les vôtres. Le workspace doit exister et contenir les cibles et destinations utiles. Ces commandes sont des instructions à exécuter vous-même : le produit ne modifie pas automatiquement la configuration d’une autre application.

**Les chemins des commandes ci-dessous utilisent la structure du checkout Git.** Dans le ZIP de skill empaqueté dans Releases, le dossier extrait `rea-pro-max/` est la racine de la skill : lancez-y `node scripts/rea-pro-max.mjs demo --out ./rpm-lab`, utilisez `/absolute/path/to/rea-pro-max/scripts/mcp-server.mjs` pour MCP et copiez tout le dossier pour l’installation. [Structure et commandes ZIP, en anglais](../INSTALL.md#choose-your-package-layout). Les archives Source code automatiques de GitHub conservent la structure du checkout.

```sh
claude mcp add --transport stdio --scope local rea-pro-max -- node "/absolute/path/to/rea-pro-max/skills/rea-pro-max/scripts/mcp-server.mjs" --workspace "/absolute/path/to/your-workspace"
```

```sh
codex mcp add rea-pro-max -- node "/absolute/path/to/rea-pro-max/skills/rea-pro-max/scripts/mcp-server.mjs" --workspace "/absolute/path/to/your-workspace"
```

Reconnectez l’environnement, vérifiez les outils et demandez un appel à `get_capabilities`. Si l’application de bureau utilise un autre PATH, indiquez le chemin absolu de Node. Le [guide MCP en anglais](../MCP.md) décrit le JSON de configuration, les arguments, limites et erreurs.

Le serveur utilise stdio local. Lancé directement, il attend des messages MCP plutôt qu’une interface interactive :

```sh
node /absolute/path/to/rea-pro-max/skills/rea-pro-max/scripts/mcp-server.mjs --workspace /absolute/path/to/your-workspace
```

### Installer la skill pour une demande naturelle

Copiez **tout** le dossier `skills/rea-pro-max` vers `.claude/skills/rea-pro-max` dans un projet Claude Code ou `.agents/skills/rea-pro-max` dans Codex. `lib`, `scripts`, `references` et `assets` font partie du système exécutable. Copier seulement `SKILL.md` retire ses mécanismes.

Utilisez ensuite `/rea-pro-max` dans Claude Code, ou sélectionnez/mentionnez `$rea-pro-max` dans Codex. [INSTALL.md en anglais](../INSTALL.md) donne les copies sans écrasement, emplacements personnels et instructions Windows.

### Exécuter directement la CLI

La démo ci-dessous fonctionne sans MCP. Choisissez skill, MCP ou CLI selon votre environnement ; le serveur REA d’origine n’est pas requis.

## Catalogue MCP : de l’artefact à un résultat livrable

| Outil | Travail |
| --- | --- |
| `get_capabilities` | Consulte version, workspace, périmètre, limites et politique d’exécution. |
| `inspect_artifact` | Analyse statiquement la cible admise et conserve le résultat complet derrière un handle. |
| `read_artifact` | Lit des sections ou pages sans répéter tout le graphe. |
| `read_source_evidence` | Lit un extrait borné correspondant à la preuve, avec hash vérifié. |
| `capture_feature` | Capture un scénario MV3 dans Chromium réel si le runtime est activé. |
| `replay_feature` | Exécute référence et récepteur séparément ; conserve verdict et divergence. |
| `create_case` | Crée un dossier avec l’identité réelle de la cible inspectée. |
| `revise_case` | Valide le patch et la révision attendue avant modification. |
| `record_observation` | Conserve observations, source, autorité et bindings déclarés. |
| `rank_probes` | Classe les expériences autorisées sans les exécuter. |
| `verify_behavior` | Compare les fichiers d’observations selon un contrat fini. |
| `export_artifact` | Écrit JSON ou HTML autonome dans un nouveau fichier du workspace. |
| `run_owned_lab` | Exécute uniquement le modèle contrôlé des workers propres fournis. |
| `list_task_prompts` | Parcourt les 36 modèles par famille et page. |
| `import_case` | Reprend un dossier JSON exporté et validé. |

Les handles sont des identifiants opaques en mémoire du processus. Le cache est borné ; après redémarrage ou éviction, importez le dossier sauvegardé ou analysez à nouveau. Lisez les parties utiles avec `read_artifact`. Les schémas découverts par le client définissent les arguments exacts.

MCP limite les chemins au workspace, refuse les liens symboliques et n’écrase pas les sorties. Seul `--browser` au démarrage active les outils dédiés exécutant des extensions MV3 du protocole dans des profils temporaires. Aucun shell ni oracle arbitraire. C’est une politique d’outils, pas un bac à sable système ou réseau.

## Essayez le mécanisme avant de croire la promesse

Il faut **Node.js 22+**. Les outils s’exécutent directement, sans clé API, `npm install` ni serveur REA d’origine.

```sh
git clone https://github.com/hieunguyenak92/rea-pro-max.git rea-pro-max
cd rea-pro-max
node skills/rea-pro-max/scripts/rea-pro-max.mjs demo --out ./rpm-lab
```

Ouvrez `rpm-lab/report.html` dans votre navigateur. Le laboratoire synthétique du projet exécute les workers de référence et de régression dans un **modèle JavaScript contrôlé utilisant des API Chrome simulées**. Analyse, classement des tests, détection d’écarts et réduction sont de vrais résultats du noyau. Cela ne démontre pas une suspension du worker dans Chromium réel. Les observations d’exécution distinctes figurent dans le [dossier de vérification](../VALIDATION.md).

Analysez vous-même l’artefact fourni :

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs inspect ./rpm-lab/fixtures/mv3/reference --out inspection.json
node skills/rea-pro-max/scripts/rea-pro-max.mjs report inspection.json --out inspection.html
node skills/rea-pro-max/scripts/rea-pro-max.mjs prompts --target mv3
```

Choisissez de nouveaux chemins de sortie : les résultats existants ne sont pas écrasés silencieusement. Consultez le [guide d’installation et de CLI](../INSTALL.md), en anglais, pour configurer l’environnement et utiliser d’autres commandes.

## Une expertise que vous pouvez examiner

| Capacité | Ce qu’elle apporte à l’enquête |
| --- | --- |
| Analyse des frontières | AST avec Acorn, contextes distincts, liens de communication candidats, positions exactes et empreintes de contenu. `inspect` n’exécute pas le code cible. |
| Explications concurrentes | Hypothèses, prédictions et recettes de test avec réinitialisation explicite, plutôt qu’une première explication simplement plausible. |
| Classement conservateur | Élimination d’hypothèses dans le pire cas par coût déclaré, filtrée par capacités, effets autorisés et budget. Les prédictions manquantes restent inconnues. |
| Observations liées au contexte | Les identités de cible, scénario, réinitialisation et chaîne d’outils écartent les observations incompatibles. Une empreinte identifie le contenu ; elle ne prouve pas l’exécution. |
| Vérification finie | `pass`, `fail` et `unknown` sur sorties, état, effets et traces. Les événements répétés et l’ordre pertinent sont préservés. |
| Réduction de la défaillance | Suppression bornée d’actions avec contrôles répétés de l’oracle et maintien de la même empreinte d’échec. Aucune promesse de séquence globalement minimale. |
| Workbench local | HTML autonome avec recherche, filtres de contexte, sélection de preuves et export JSON complet. Sans serveur applicatif ni CDN. |
| 36 prompts de tâches | Web, extensions, bureau et familles mobiles, avec prérequis explicites. Un modèle de prompt ne certifie pas une intégration de fournisseur. |

Le planificateur choisit la prochaine question ; il ne lance pas le test. Le vérificateur compare les observations fournies ; il n’atteste pas lui-même qu’une exécution a eu lieu. La skill guide l’agent pour effectuer ce travail et en conserver les preuves.

## Un périmètre clair pour des résultats interprétables

**Analyse intégrée à la v0.3 :** fichiers JavaScript et sources extraites web, Manifest V3 et Electron. Expressions dynamiques, syntaxe non prise en charge, imports absents et limites de ressources restent explicites.

**Noyau indépendant des fournisseurs :** gestion de dossiers, classement d’expériences, comparaison finie, réduction de séquences et rapports locaux. `shrink` exécute explicitement le module oracle `.mjs` que vous fournissez et maîtrisez.

**Travaux avancés avec les outils de l’environnement :** prompts native, managed, Android, Apple, React Native, Flutter, Tauri et WebAssembly. L’analyse approfondie nécessite des outils adaptés réellement disponibles. Cette version n’intègre ni décompilateur universel, ni runtime mobile, ni extracteur de tous les formats, ni moteur de récupération sémantique. Une détection de format ou un prompt ne constitue pas une intégration vérifiée.

CLI/MCP ne téléverse aucune télémétrie et n’appelle pas d’API de modèle. Les opérations statiques sont locales ; le runtime optionnel utilise une connexion de débogage loopback, et le navigateur ou l’extension peut accéder au réseau selon ses permissions. L’environnement IA garde ses propres règles. [Confidentialité et exécution, en anglais](../PRIVACY.md).

## Ce que vous conservez

Une reconstruction doit livrer le code exécutable et son lancement, le contrat retenu, les opérations réellement essayées, les preuves JSON et les limites restantes. Un `pass` fini concerne les cas contrôlés ; il ne prouve pas l’équivalence de l’application entière.

Le laboratoire exporte `inspection.json`, `case.json`, `planner.json`, `reference.json`, `candidate.json`, `verification.json`, `reduction.json`, `lab.json` et le rapport autonome `report.html`. Examinez les enregistrements séparément, conservez-les avec votre projet et exportez le JSON complet depuis le workbench.

## Des exemples réels et des preuves consultables

**Recherche Unicode :** l’[implémentation destinataire](../../examples/recovered-search/CONTRACT.md) reconstruit le contrat choisi de la fixture web : NFKC, minuscules selon la locale, sous-chaînes, ordre stable et identifiants textuels. Référence et application destinataire ont été lancées séparément. Cas finis et limites figurent dans [VALIDATION.md](../VALIDATION.md). Le même agent a créé et vérifié cet exemple avec accès aux sources ; ce n’est ni une étude aveugle ni un benchmark causal de la skill.

![Implémentation de recherche lancée séparément](../media/recovered-search.png)

**Export Electron :** la fixture propre a traversé renderer → preload → `ipcRenderer.invoke` → main, puis le JSON local a été relu. Les connexions statiques gardent une autorité de candidat ; l’observation d’exécution documente l’opération exercée.

![Réponse réelle de l’export Electron](../media/electron-runtime.png)

## Les décisions expertes dans le moteur

Le score d’un test divise les hypothèses éliminables dans le pire cas par son coût déclaré. Capacités, effets autorisés et budget filtrent d’abord les recettes. Si toutes les hypothèses contredisent les observations qualifiées, le résultat peut être `model_incomplete` ; sans expérience admissible discriminante, `no_discriminating_probe`. L’incertitude ne devient pas un pourcentage de confiance sans fondement.

Le vérificateur ne normalise que des chemins de metadata explicites, sans supprimer les différences output/state/effects/trace. Les contrats d’ordre total ou par canal gardent doublons et ordre pertinent. Le réducteur répète les contrôles de l’oracle, admet une réinitialisation avant chaque tentative et conserve la même empreinte de défaillance. La minimalité se limite aux suppressions réellement vérifiées.

## FAQ et dépannage

**Faut-il MCP et la skill ensemble ?** Non. MCP apporte les outils structurés, la skill les instructions de tâche. La CLI reste utilisable directement.

**La skill écrit-elle la fonction ?** Elle guide l’agent pour l’implémenter et l’exécuter dans votre projet. Un rapport ne termine pas une demande de reconstruction.

**Le dossier survit-il à l’arrêt MCP ?** Exportez-le en JSON avant l’arrêt puis utilisez `import_case` dans une nouvelle session. Les handles ne persistent pas entre processus.

**Pourquoi `unknown` ?** Examinez observations incomplètes, entrées non comparables et bindings scenario/reset/toolchain/verifier. Ce résultat ne devient pas automatiquement `pass`.

| Problème | Action suivante |
| --- | --- |
| MCP ne démarre pas | Vérifiez Node22+, chemins absolus et workspace existant. |
| Aucun outil visible | Reconnectez, consultez le statut serveur et les autorisations MCP. |
| Handle indisponible | Importez un dossier sauvegardé ou réanalysez après redémarrage/éviction. |
| Conflit de révision | Lisez le dossier récent et utilisez sa révision réelle. |
| Limite ou chemin hors périmètre | Réduisez l’artefact ou choisissez le bon workspace. |
| Sortie existante | Choisissez un autre nom et préservez l’ancienne preuve. |

Prochaines directions : résolution statique plus poussée avec incertitude explicite, davantage d’exemples reproductibles de récupération et intégrations par version lorsqu’elles peuvent être exercées. Ce sont des orientations, pas des compatibilités déjà livrées.

Références techniques en anglais : [Skill](../../skills/rea-pro-max/SKILL.md) · [Périmètre](../../skills/rea-pro-max/references/target-analysis.md) · [Format des dossiers](../../skills/rea-pro-max/references/case-format.md) · [Contrat de vérification](../../skills/rea-pro-max/references/verification.md) · [Prompts](../../skills/rea-pro-max/references/prompt-library.md).

Projet développé indépendamment. L’inspiration de recherche et les mentions des dépendances figurent dans les [crédits](../../THIRD_PARTY_NOTICES.md) ; REA d’origine n’est pas une dépendance obligatoire. [Licence MIT](../../LICENSE).

**Apportez une fonction qui mérite d’être comprise. Repartez avec un résultat vérifiable.**

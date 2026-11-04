# REA Pro Max

**Comprendre le mécanisme. Reconstruire le comportement. Vérifier le résultat.**

Une skill indépendante de rétro-ingénierie et une boîte à outils exécutable pour Claude Code et Codex. Transformez une application, une extension ou une fonction web inconnue en un mécanisme explicable, une implémentation exécutable et un contrat de comportement fini que vous pouvez contrôler.

[English](README.md) · [Tiếng Việt](README.vi.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [简体中文](README.zh-CN.md) · [ไทย](README.th.md) · [Français](README.fr.md)

[Explorer le laboratoire enregistré](https://hieunguyenak92.github.io/rea-pro-max/#explorer) · [Installer la skill](docs/INSTALL.md) · [Dossier de vérification](docs/VALIDATION.md) · [Versions](https://github.com/hieunguyenak92/rea-pro-max/releases)

![REA Pro Max — Understand the mechanism](docs/media/hero.png)

## Une interface convaincante n’est qu’un début

La difficulté commence après le clic : quel contexte reçoit le message, où l’état persiste, ce que l’annulation interrompt, quelle erreur revient à l’appelant et pourquoi la fonction reconstruite échoue à la deuxième tentative.

REA Pro Max intègre ces questions au travail d’implémentation. Analysez le JavaScript distribué. Formulez des explications concurrentes. Choisissez une expérience qui les départage. Implémentez le comportement demandé dans votre projet. Comparez les sorties, les changements d’état et les événements observés. Réduisez un écart aux actions qui reproduisent toujours la même défaillance.

**Le livrable est la fonctionnalité opérationnelle demandée, accompagnée de preuves.** L’agent de votre environnement effectue le développement et les opérations d’exécution ; les outils fournis apportent des mécanismes exécutables d’analyse, de classement des expériences, de vérification et de réduction.

## Confiez une tâche, sans apprendre un nouveau processus

Après [installation](docs/INSTALL.md), demandez le travail dans Claude Code :

```text
/rea-pro-max Étudie comment cette extension enregistre et restaure les données, puis implémente ce comportement dans mon projet. Trace les frontières entre popup, content script, worker et stockage. Vérifie la persistance après un redémarrage confirmé du worker, conserve les erreurs et livre du code exécutable, les cas réellement testés et les points encore non vérifiés.
```

Dans Codex, sélectionnez la skill ou ajoutez `$rea-pro-max` au début de la même demande. Fournissez la cible et le projet destinataire ; l’agent prépare les fichiers internes du dossier. Observer un navigateur, une application ou un appareil réel nécessite les outils correspondants dans votre environnement.

- **Reconstruire une fonction précise :** ordre, erreurs, annulation et limites de persistance.
- **Comprendre une extension MV3 :** distinguer popup, content, page et worker.
- **Retrouver les frontières Electron :** analyser les sources extraites de main, preload et renderer.
- **Expliquer une régression entre builds :** comparer entrées compatibles et effets observables.
- **Réduire une défaillance reproductible :** raccourcir la séquence en conservant son identité.

## Essayez le mécanisme avant de croire la promesse

Il faut **Node.js 22+**. Les outils s’exécutent directement, sans clé API, `npm install` ni serveur REA d’origine.

```sh
git clone https://github.com/hieunguyenak92/rea-pro-max.git rea-pro-max
cd rea-pro-max
node skills/rea-pro-max/scripts/rea-pro-max.mjs demo --out ./rpm-lab
```

Ouvrez `rpm-lab/report.html` dans votre navigateur. Le laboratoire synthétique du projet exécute les workers de référence et de régression dans un **modèle JavaScript contrôlé utilisant des API Chrome simulées**. Analyse, classement des tests, détection d’écarts et réduction sont de vrais résultats du noyau. Cela ne démontre pas une suspension du worker dans Chromium réel. Les observations d’exécution distinctes figurent dans le [dossier de vérification](docs/VALIDATION.md).

Analysez vous-même l’artefact fourni :

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs inspect ./rpm-lab/fixtures/mv3/reference --out inspection.json
node skills/rea-pro-max/scripts/rea-pro-max.mjs report inspection.json --out inspection.html
node skills/rea-pro-max/scripts/rea-pro-max.mjs prompts --target mv3
```

Choisissez de nouveaux chemins de sortie : les résultats existants ne sont pas écrasés silencieusement. Consultez le [guide d’installation et de CLI](docs/INSTALL.md), en anglais, pour configurer l’environnement et utiliser d’autres commandes.

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

**Analyse intégrée à la v0.1 :** fichiers JavaScript et sources extraites web, Manifest V3 et Electron. Expressions dynamiques, syntaxe non prise en charge, imports absents et limites de ressources restent explicites.

**Noyau indépendant des fournisseurs :** gestion de dossiers, classement d’expériences, comparaison finie, réduction de séquences et rapports locaux. `shrink` exécute explicitement le module oracle `.mjs` que vous fournissez et maîtrisez.

**Travaux avancés avec les outils de l’environnement :** prompts native, managed, Android, Apple, React Native, Flutter, Tauri et WebAssembly. L’analyse approfondie nécessite des outils adaptés réellement disponibles. Cette version n’intègre ni décompilateur universel, ni runtime mobile, ni extracteur de tous les formats, ni moteur de récupération sémantique. Une détection de format ou un prompt ne constitue pas une intégration vérifiée.

La CLI n’effectue pas de requêtes réseau ni d’envoi de télémétrie. Votre environnement d’IA et les outils externes suivent leurs propres politiques de données. Les rapports peuvent contenir chemins, code et valeurs sensibles. Lisez [confidentialité et limites d’exécution](docs/PRIVACY.md), en anglais, avant de les partager.

## Ce que vous conservez

Une reconstruction doit livrer le code exécutable et son lancement, le contrat retenu, les opérations réellement essayées, les preuves JSON et les limites restantes. Un `pass` fini concerne les cas contrôlés ; il ne prouve pas l’équivalence de l’application entière.

Le laboratoire exporte `inspection.json`, `case.json`, `planner.json`, `reference.json`, `candidate.json`, `verification.json`, `reduction.json`, `lab.json` et le rapport autonome `report.html`. Examinez les enregistrements séparément, conservez-les avec votre projet et exportez le JSON complet depuis le workbench.

Références techniques en anglais : [Skill](skills/rea-pro-max/SKILL.md) · [Périmètre](skills/rea-pro-max/references/target-analysis.md) · [Format des dossiers](skills/rea-pro-max/references/case-format.md) · [Contrat de vérification](skills/rea-pro-max/references/verification.md) · [Prompts](skills/rea-pro-max/references/prompt-library.md).

Projet développé indépendamment. L’inspiration de recherche et les mentions des dépendances figurent dans les [crédits](THIRD_PARTY_NOTICES.md) ; REA d’origine n’est pas une dépendance obligatoire. [Licence MIT](LICENSE).

**Apportez une fonction qui mérite d’être comprise. Repartez avec un résultat vérifiable.**

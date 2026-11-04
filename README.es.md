# REA Pro Max

**Comprende el mecanismo. Reconstruye el comportamiento. Verifica el resultado.**

Una skill independiente de ingeniería inversa y un conjunto de herramientas ejecutables para Claude Code y Codex. Convierte una app, extensión o función web desconocida en un mecanismo que puedas explicar, una implementación que puedas ejecutar y un contrato de comportamiento finito que puedas comprobar.

[English](README.md) · [Tiếng Việt](README.vi.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [简体中文](README.zh-CN.md) · [ไทย](README.th.md) · [Français](README.fr.md)

[Explora el laboratorio grabado](https://hieunguyenak92.github.io/rea-pro-max/#explorer) · [Instala la skill](docs/INSTALL.md) · [Registro de verificación](docs/VALIDATION.md) · [Versiones](https://github.com/hieunguyenak92/rea-pro-max/releases)

![REA Pro Max — Understand the mechanism](docs/media/hero.png)

## Una interfaz convincente es solo el comienzo

Lo difícil ocurre después del clic: qué contexto recibe el mensaje, dónde persiste el estado, qué interrumpe la cancelación, qué error recibe quien llama y por qué la función reconstruida falla en el segundo intento.

REA Pro Max incorpora esas preguntas al trabajo de implementación. Analiza el JavaScript distribuido. Formula explicaciones alternativas. Elige un experimento que las distinga. Implementa el comportamiento solicitado en tu proyecto. Compara las salidas, los cambios de estado y los eventos observados. Reduce una discrepancia a las acciones que todavía reproducen el mismo fallo.

**El entregable es la función operativa que pediste, respaldada por evidencias.** El agente del entorno realiza la programación y las operaciones en ejecución; las herramientas incluidas aportan análisis, priorización de experimentos, verificación y reducción mediante código ejecutable.

## Asigna una tarea, sin aprender otro proceso

Después de [instalarla](docs/INSTALL.md), pide el trabajo en Claude Code:

```text
/rea-pro-max Investiga cómo esta extensión guarda y restaura datos e implementa ese comportamiento en mi proyecto. Traza los límites entre popup, content script, worker y almacenamiento. Comprueba la persistencia tras un reinicio confirmado del worker, conserva los errores y entrega código ejecutable, los casos realmente comprobados y lo que siga sin verificar.
```

En Codex, selecciona la skill o añade `$rea-pro-max` al principio de la misma tarea. Proporciona el objetivo y el proyecto de destino; el agente prepara los archivos internos del caso. Observar un navegador, una app o un dispositivo real requiere las herramientas correspondientes en tu entorno.

- **Reconstruye una función concreta:** orden, errores, cancelación y límites de persistencia.
- **Entiende una extensión MV3:** separa los contextos popup, content, page y worker.
- **Recupera los límites de Electron:** analiza fuentes extraídas de main, preload y renderer.
- **Explica una regresión entre builds:** usa entradas y efectos observables comparables.
- **Reduce un fallo reproducible:** conserva su identidad mientras acortas la secuencia.

## Prueba el mecanismo antes de confiar en la promesa

Necesitas **Node.js 22+**. Las herramientas se ejecutan directamente, sin clave de API, `npm install` ni servidor REA original.

```sh
git clone https://github.com/hieunguyenak92/rea-pro-max.git rea-pro-max
cd rea-pro-max
node skills/rea-pro-max/scripts/rea-pro-max.mjs demo --out ./rpm-lab
```

Abre `rpm-lab/report.html` en el navegador. El laboratorio sintético propio ejecuta workers de referencia y con regresión en un **modelo JavaScript controlado con API de Chrome simuladas**. El análisis, la clasificación de pruebas, la detección de diferencias y la reducción son resultados reales del núcleo. Esto no demuestra la suspensión de un worker en Chromium real. Las comprobaciones de ejecución independientes aparecen en el [registro de verificación](docs/VALIDATION.md).

Analiza el artefacto incluido:

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs inspect ./rpm-lab/fixtures/mv3/reference --out inspection.json
node skills/rea-pro-max/scripts/rea-pro-max.mjs report inspection.json --out inspection.html
node skills/rea-pro-max/scripts/rea-pro-max.mjs prompts --target mv3
```

Utiliza rutas de salida nuevas: los resultados existentes no se sobrescriben silenciosamente. Consulta la [guía de instalación y CLI](docs/INSTALL.md), en inglés, para configurar el entorno y usar más comandos.

## Conocimiento experto que puedes inspeccionar

| Capacidad | Qué aporta a la investigación |
| --- | --- |
| Análisis de límites | AST con Acorn, contextos separados, conexiones de comunicación candidatas, ubicaciones exactas y resúmenes de contenido. `inspect` no ejecuta el código objetivo. |
| Explicaciones alternativas | Hipótesis, predicciones y recetas de prueba con reinicio explícito, en vez de aceptar la primera explicación plausible. |
| Priorización conservadora | Eliminación de hipótesis en el peor caso por coste declarado, filtrada por capacidades, efectos permitidos y presupuesto. Las predicciones ausentes siguen siendo desconocidas. |
| Observaciones vinculadas | Las identidades de objetivo, escenario, reinicio y herramientas excluyen observaciones incompatibles de la inferencia actual. Un hash identifica el contenido; no acredita que la ejecución ocurrió. |
| Verificación finita | `pass`, `fail` y `unknown` para salidas, estado, efectos y trazas, conservando eventos duplicados y orden relevante. |
| Reducción del fallo | Eliminación acotada de acciones con comprobaciones repetidas del oráculo y la misma huella del fallo. No promete la secuencia globalmente más corta. |
| Workbench local | HTML autónomo con búsqueda, filtros de contexto, selección de evidencias y exportación completa a JSON. Sin backend ni CDN. |
| 36 prompts de tareas | Web, extensiones, escritorio y familias móviles, con requisitos explícitos. Una plantilla no certifica compatibilidad con un proveedor. |

El planificador elige la siguiente pregunta; no ejecuta la prueba. El verificador compara observaciones aportadas; no certifica por sí mismo la ejecución. La skill dirige al agente para realizar ese trabajo y conservar la evidencia.

## Alcance definido, límites visibles

**Análisis integrado en v0.1:** archivos JavaScript y fuentes extraídas de web, Manifest V3 y Electron. Expresiones dinámicas, sintaxis no admitida, imports ausentes y límites de recursos quedan explícitos.

**Núcleo independiente de proveedores:** gestión de casos, clasificación de experimentos, comparación finita, reducción de secuencias e informes locales. `shrink` ejecuta explícitamente el módulo oráculo `.mjs` que proporcionas y controlas.

**Flujos avanzados con herramientas del entorno:** prompts para native, managed, Android, Apple, React Native, Flutter, Tauri y WebAssembly. El análisis profundo depende de herramientas adecuadas disponibles. No se incluyen un descompilador universal, runtime móvil, extractor para cualquier paquete ni motor de recuperación semántica. Detectar un formato o tener una plantilla no equivale a una integración verificada.

La CLI no hace solicitudes de red ni sube telemetría. Tu entorno de IA y las herramientas externas siguen sus propias políticas de datos. Los informes pueden incluir rutas, código y valores sensibles. Lee [privacidad y límites de ejecución](docs/PRIVACY.md), en inglés, antes de compartirlos.

## Lo que te llevas

Una reconstrucción debe entregar código ejecutable y cómo iniciarlo, el contrato elegido, las operaciones realmente probadas, evidencias JSON y límites restantes. Un `pass` finito se aplica a los casos comprobados, no a la equivalencia de toda la aplicación.

El laboratorio exporta `inspection.json`, `case.json`, `planner.json`, `reference.json`, `candidate.json`, `verification.json`, `reduction.json`, `lab.json` y el informe autónomo `report.html`. Puedes revisar los registros por separado, guardarlos con tu proyecto y exportar todo el contenido JSON desde el workbench.

Referencias técnicas en inglés: [Skill](skills/rea-pro-max/SKILL.md) · [Alcance](skills/rea-pro-max/references/target-analysis.md) · [Formato de casos](skills/rea-pro-max/references/case-format.md) · [Contrato de verificación](skills/rea-pro-max/references/verification.md) · [Prompts](skills/rea-pro-max/references/prompt-library.md).

Proyecto desarrollado de forma independiente. La inspiración de investigación y los avisos de dependencias están en los [créditos](THIRD_PARTY_NOTICES.md); REA original no es una dependencia obligatoria. [Licencia MIT](LICENSE).

**Trae una función que merezca comprenderse. Llévate un resultado que puedas comprobar.**

# REA Pro Max

**Comprende el mecanismo. Reconstruye el comportamiento. Verifica el resultado.**

Un conjunto independiente de herramientas de ingeniería inversa con MCP local, skill de agente y CLI directa, para Claude Code, Codex y clientes MCP compatibles. Convierte una app, extensión o función web desconocida en un mecanismo que puedas explicar, una implementación que puedas ejecutar y un contrato de comportamiento finito que puedas comprobar.

[English](../../README.md) · [Tiếng Việt](vi.md) · [한국어](ko.md) · [日本語](ja.md) · [Español](es.md) · [Português](pt-BR.md) · [简体中文](zh-CN.md) · [ไทย](th.md) · [Français](fr.md)

[Explora el laboratorio grabado](https://hieunguyenak92.github.io/rea-pro-max/#explorer) · [Instala la skill](../INSTALL.md) · [Registro de verificación](../VALIDATION.md) · [Versiones](https://github.com/hieunguyenak92/rea-pro-max/releases)

![REA Pro Max — Understand the mechanism](../media/hero.png)

![Workbench real de REA Pro Max del laboratorio sintético propio](../media/workbench.png)

*Informe real del modelo JavaScript con API de Chrome simuladas; no demuestra el ciclo de vida de Chromium real.*

## Una interfaz convincente es solo el comienzo

Lo difícil ocurre después del clic: qué contexto recibe el mensaje, dónde persiste el estado, qué interrumpe la cancelación, qué error recibe quien llama y por qué la función reconstruida falla en el segundo intento.

REA Pro Max incorpora esas preguntas al trabajo de implementación. Analiza el JavaScript distribuido. Formula explicaciones alternativas. Elige un experimento que las distinga. Implementa el comportamiento solicitado en tu proyecto. Compara las salidas, los cambios de estado y los eventos observados. Reduce una discrepancia a las acciones que todavía reproducen el mismo fallo.

**El entregable es la función operativa que pediste, respaldada por evidencias.** El agente del entorno realiza la programación y las operaciones en ejecución; las herramientas incluidas aportan análisis, priorización de experimentos, verificación y reducción mediante código ejecutable.

## Asigna una tarea, sin aprender otro proceso

Después de [instalarla](../INSTALL.md), pide el trabajo en Claude Code:

```text
/rea-pro-max Investiga cómo esta extensión guarda y restaura datos e implementa ese comportamiento en mi proyecto. Traza los límites entre popup, content script, worker y almacenamiento. Comprueba la persistencia tras un reinicio confirmado del worker, conserva los errores y entrega código ejecutable, los casos realmente comprobados y lo que siga sin verificar.
```

En Codex, selecciona la skill o añade `$rea-pro-max` al principio de la misma tarea. Proporciona el objetivo y el proyecto de destino; el agente prepara los archivos internos del caso. Observar un navegador, una app o un dispositivo real requiere las herramientas correspondientes en tu entorno.

- **Reconstruye una función concreta:** orden, errores, cancelación y límites de persistencia.
- **Entiende una extensión MV3:** separa los contextos popup, content, page y worker.
- **Recupera los límites de Electron:** analiza fuentes extraídas de main, preload y renderer.
- **Explica una regresión entre builds:** usa entradas y efectos observables comparables.
- **Reduce un fallo reproducible:** conserva su identidad mientras acortas la secuencia.

## Una herramienta. Tres formas de empezar.

**v0.2 incorpora MCP local con 12 herramientas** para que el agente invoque directamente el núcleo de análisis y verificación. La skill aporta el procedimiento; la CLI permite ejecutar y revisar resultados de forma independiente. El runtime incluye el parser y el SDK oficial de MCP, sin instalación npm para usarlo.

### Conecta MCP a Claude Code o Codex

Sustituye las rutas absolutas por las tuyas. El workspace debe existir y contener los objetivos y las ubicaciones de salida necesarios. Son instrucciones para que las ejecutes: el producto no modifica automáticamente la configuración de otra aplicación.

**Las rutas de los comandos siguientes usan la estructura del checkout Git.** En el ZIP de la skill empaquetado en Releases, `rea-pro-max/` extraído es la raíz de la skill: ejecuta allí `node scripts/rea-pro-max.mjs demo --out ./rpm-lab`, usa `/absolute/path/to/rea-pro-max/scripts/mcp-server.mjs` para MCP y copia toda la carpeta al instalar. [Estructura y comandos ZIP, en inglés](../INSTALL.md#choose-your-package-layout). Los archivos Source code automáticos de GitHub mantienen la estructura del checkout.

```sh
claude mcp add --transport stdio --scope local rea-pro-max -- node "/absolute/path/to/rea-pro-max/skills/rea-pro-max/scripts/mcp-server.mjs" --workspace "/absolute/path/to/your-workspace"
```

```sh
codex mcp add rea-pro-max -- node "/absolute/path/to/rea-pro-max/skills/rea-pro-max/scripts/mcp-server.mjs" --workspace "/absolute/path/to/your-workspace"
```

Reconecta el entorno, comprueba las herramientas y pide una llamada a `get_capabilities`. Si la app de escritorio tiene otro PATH, utiliza la ruta absoluta del ejecutable Node. La [guía MCP en inglés](../MCP.md) incluye configuración JSON, argumentos, límites y tratamiento de errores.

El servidor usa stdio local. Al iniciarlo directamente espera mensajes MCP; no muestra una interfaz interactiva:

```sh
node /absolute/path/to/rea-pro-max/skills/rea-pro-max/scripts/mcp-server.mjs --workspace /absolute/path/to/your-workspace
```

### Instala la skill para asignar tareas naturales

Copia **toda** la carpeta `skills/rea-pro-max` a `.claude/skills/rea-pro-max` en un proyecto Claude Code o `.agents/skills/rea-pro-max` en Codex. `lib`, `scripts`, `references` y `assets` forman parte del sistema ejecutable. Copiar solo `SKILL.md` deja fuera sus mecanismos.

Después utiliza `/rea-pro-max` en Claude Code o selecciona/menciona `$rea-pro-max` en Codex. [INSTALL.md en inglés](../INSTALL.md) incluye copias sin sobrescritura, ubicaciones personales e instrucciones para Windows.

### Ejecuta la CLI de forma independiente

La demo que aparece a continuación funciona sin MCP. Elige skill, MCP o CLI según tu entorno; el servidor REA original no es un requisito.

## Catálogo MCP: del artefacto a un resultado entregable

| Herramienta | Trabajo |
| --- | --- |
| `get_capabilities` | Consulta versión, workspace, alcance, límites y política de ejecución. |
| `inspect_artifact` | Analiza estáticamente el objetivo admitido y conserva el resultado completo tras un handle. |
| `read_artifact` | Lee secciones o páginas sin repetir todo el grafo. |
| `create_case` | Crea un caso con la identidad real del objetivo inspeccionado. |
| `revise_case` | Valida el parche y la revisión esperada antes de actualizar. |
| `record_observation` | Conserva observaciones, fuente, autoridad y bindings declarados. |
| `rank_probes` | Ordena experimentos permitidos; no los ejecuta. |
| `verify_behavior` | Compara archivos de observaciones bajo un contrato finito. |
| `export_artifact` | Guarda JSON o HTML autónomo en un archivo nuevo del workspace. |
| `run_owned_lab` | Ejecuta únicamente el modelo controlado con workers propios incluidos. |
| `list_task_prompts` | Consulta las 36 plantillas por familia y página. |
| `import_case` | Reanuda un caso JSON exportado y validado. |

Los handles son identificadores opacos en la memoria del proceso. La caché tiene límites; tras un reinicio o expulsión, importa el caso guardado o repite el análisis. Usa `read_artifact` para obtener lo necesario. Los esquemas descubiertos por el cliente definen los argumentos exactos.

MCP limita las rutas elegidas por el cliente al workspace, rechaza enlaces simbólicos y no sobrescribe salidas. Es una política de admisión de herramientas, no un sandbox del sistema operativo para Node ni para otras herramientas del entorno. No expone shell, lanzamiento de apps, control del navegador ni ejecución arbitraria de oráculos. `run_owned_lab` ejecuta solo código propio fijo.

## Prueba el mecanismo antes de confiar en la promesa

Necesitas **Node.js 22+**. Las herramientas se ejecutan directamente, sin clave de API, `npm install` ni servidor REA original.

```sh
git clone https://github.com/hieunguyenak92/rea-pro-max.git rea-pro-max
cd rea-pro-max
node skills/rea-pro-max/scripts/rea-pro-max.mjs demo --out ./rpm-lab
```

Abre `rpm-lab/report.html` en el navegador. El laboratorio sintético propio ejecuta workers de referencia y con regresión en un **modelo JavaScript controlado con API de Chrome simuladas**. El análisis, la clasificación de pruebas, la detección de diferencias y la reducción son resultados reales del núcleo. Esto no demuestra la suspensión de un worker en Chromium real. Las comprobaciones de ejecución independientes aparecen en el [registro de verificación](../VALIDATION.md).

Analiza el artefacto incluido:

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs inspect ./rpm-lab/fixtures/mv3/reference --out inspection.json
node skills/rea-pro-max/scripts/rea-pro-max.mjs report inspection.json --out inspection.html
node skills/rea-pro-max/scripts/rea-pro-max.mjs prompts --target mv3
```

Utiliza rutas de salida nuevas: los resultados existentes no se sobrescriben silenciosamente. Consulta la [guía de instalación y CLI](../INSTALL.md), en inglés, para configurar el entorno y usar más comandos.

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

**Análisis integrado en v0.2:** archivos JavaScript y fuentes extraídas de web, Manifest V3 y Electron. Expresiones dinámicas, sintaxis no admitida, imports ausentes y límites de recursos quedan explícitos.

**Núcleo independiente de proveedores:** gestión de casos, clasificación de experimentos, comparación finita, reducción de secuencias e informes locales. `shrink` ejecuta explícitamente el módulo oráculo `.mjs` que proporcionas y controlas.

**Flujos avanzados con herramientas del entorno:** prompts para native, managed, Android, Apple, React Native, Flutter, Tauri y WebAssembly. El análisis profundo depende de herramientas adecuadas disponibles. No se incluyen un descompilador universal, runtime móvil, extractor para cualquier paquete ni motor de recuperación semántica. Detectar un formato o tener una plantilla no equivale a una integración verificada.

La CLI no hace solicitudes de red ni sube telemetría. Tu entorno de IA y las herramientas externas siguen sus propias políticas de datos. Los informes pueden incluir rutas, código y valores sensibles. Lee [privacidad y límites de ejecución](../PRIVACY.md), en inglés, antes de compartirlos.

## Lo que te llevas

Una reconstrucción debe entregar código ejecutable y cómo iniciarlo, el contrato elegido, las operaciones realmente probadas, evidencias JSON y límites restantes. Un `pass` finito se aplica a los casos comprobados, no a la equivalencia de toda la aplicación.

El laboratorio exporta `inspection.json`, `case.json`, `planner.json`, `reference.json`, `candidate.json`, `verification.json`, `reduction.json`, `lab.json` y el informe autónomo `report.html`. Puedes revisar los registros por separado, guardarlos con tu proyecto y exportar todo el contenido JSON desde el workbench.

## Ejemplos reales y pruebas revisables

**Búsqueda Unicode:** la [implementación receptora](../../examples/recovered-search/CONTRACT.md) reconstruye el contrato seleccionado de la web de prueba: NFKC, minúsculas según locale, coincidencia de subcadenas, orden estable e IDs de cadena. La referencia y la app receptora se iniciaron por separado. Los casos finitos y sus límites están en [VALIDATION.md](../VALIDATION.md). El mismo agente creó y comprobó este ejemplo con acceso al código; no es un estudio ciego ni un benchmark causal de la skill.

![La implementación de búsqueda ejecutada por separado](../media/recovered-search.png)

**Exportación Electron:** el fixture propio recorrió renderer → preload → `ipcRenderer.invoke` → main, y el JSON local se leyó después. Las conexiones estáticas conservan autoridad de candidato; la observación de ejecución aporta evidencia de la operación realizada.

![Respuesta real de exportación Electron](../media/electron-runtime.png)

## Decisiones expertas dentro del motor

La puntuación de una prueba divide las hipótesis eliminables en el peor caso por su coste declarado. Primero aplica capacidades, efectos permitidos y presupuesto. Si todas las hipótesis contradicen observaciones válidas, puede devolver `model_incomplete`; si ninguna prueba admisible distingue alternativas, `no_discriminating_probe`. La incertidumbre no se transforma en porcentajes de confianza sin fundamento.

El verificador solo permite normalizar rutas de metadata explícitas, sin borrar diferencias en output/state/effects/trace. Los contratos de orden total o por canal conservan duplicados y orden relevante. El reductor repite comprobaciones del oráculo, admite reinicio previo a cada intento y mantiene la huella del fallo. La minimalidad se limita a las eliminaciones realmente comprobadas.

## Preguntas frecuentes y resolución de problemas

**¿Necesito MCP y skill a la vez?** No. MCP aporta herramientas estructuradas y la skill instrucciones para la tarea. La CLI funciona directamente.

**¿La skill escribe la función?** Dirige al agente del entorno para implementarla y ejecutarla en tu proyecto. Un informe no completa una reconstrucción.

**¿El caso sobrevive al cierre de MCP?** Expórtalo a JSON antes de cerrar e impórtalo con `import_case` en otra sesión. Los handles no sobreviven entre procesos.

**¿Por qué devuelve `unknown`?** Revisa registros incompletos, entradas no comparables y bindings de scenario/reset/toolchain/verifier. No se convierte automáticamente en `pass`.

| Problema | Siguiente paso |
| --- | --- |
| MCP no arranca | Comprueba Node22+, rutas absolutas y workspace existente. |
| No aparecen herramientas | Reconecta, consulta el estado del servidor y los permisos MCP. |
| Handle no disponible | Importa un caso guardado o analiza otra vez tras reinicio/expulsión de caché. |
| Conflicto de revisión | Lee el caso más reciente y utiliza su revisión real. |
| Límite de recursos o ruta fuera de alcance | Acota el artefacto o selecciona el workspace correcto. |
| La salida ya existe | Usa un nombre nuevo y conserva la evidencia anterior. |

Próximas direcciones: mejor resolución estática con incertidumbre explícita, más ejemplos de recuperación reproducibles e integraciones de proveedores por versión cuando puedan ejercitarse. Son líneas de desarrollo, no compatibilidades ya publicadas.

Referencias técnicas en inglés: [Skill](../../skills/rea-pro-max/SKILL.md) · [Alcance](../../skills/rea-pro-max/references/target-analysis.md) · [Formato de casos](../../skills/rea-pro-max/references/case-format.md) · [Contrato de verificación](../../skills/rea-pro-max/references/verification.md) · [Prompts](../../skills/rea-pro-max/references/prompt-library.md).

Proyecto desarrollado de forma independiente. La inspiración de investigación y los avisos de dependencias están en los [créditos](../../THIRD_PARTY_NOTICES.md); REA original no es una dependencia obligatoria. [Licencia MIT](../../LICENSE).

**Trae una función que merezca comprenderse. Llévate un resultado que puedas comprobar.**

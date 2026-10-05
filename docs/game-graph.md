# Game Graph — формат нодовых графов (`game.json`, `modules/*.json`, `systems/*.json`)

Логика игры в редакторе хранится как графы нод в JSON (НЕ обфусцировано).
Файлы приходят по websocket событием `file-contents-project`:

```json
{
  "folderName": "systems",
  "fileName": "spawner.json",
  "content": "<json-строка>",
  "version": "<sha1>"
}
```

`version` — хэш контента (версионирование/кэш).

## Структура файла

```json
{
  "nodes": [
    {
      "id": "n_1",
      "schemaId": "On_Start__event",
      "x": -60,
      "y": 120,
      "fieldValues": {}
    }
  ],
  "links": [
    {
      "id": "l_3",
      "fromNode": "n_1",
      "fromPort": "exec",
      "toNode": "n_2",
      "toPort": "exec"
    }
  ]
}
```

- `x`, `y` — позиция в редакторе, на выполнение не влияет.
- `fieldValues` — дефолтные значения входных портов и конфигурация ноды (см. ниже).
- `links` — направленные соединения `out-порт → in-порт`, и exec, и data.

## Типы нод (суффикс schemaId)

### `__event` — точки входа, генерируют exec-импульс

| schemaId                  | Где             | Назначение                                                                                     | Порты out                |
| ------------------------- | --------------- | ---------------------------------------------------------------------------------------------- | ------------------------ |
| `On_Start__event`         | game.json       | старт игры                                                                                     | `exec`                   |
| `On_System_Update__event` | systems/\*.json | тик системы                                                                                    | `exec` (+ dt?)           |
| `Module__event`           | modules/\*.json | объявление модуля; `fieldValues.properties: []`                                                | —                        |
| `Method__event`           | modules/\*.json | объявление метода; `fieldValues: {method: "calc", params: [{name, type}], returns: "vector2"}` | `exec`, порты параметров |

### `__action` — исполнение (имеют `exec` in/out)

| schemaId                               | Порты / fieldValues                                               | Семантика                   |
| -------------------------------------- | ----------------------------------------------------------------- | --------------------------- |
| `Branch__action`                       | in: `exec`, `condition`; out: `true`, `false`                     | if                          |
| `For_Each_Entity__action`              | field `query`; in: `exec`; out: `body`, `entity` (+ `completed`?) | цикл по Query.get(query)    |
| `Return__action`                       | in: `exec`, `value`                                               | return из метода модуля     |
| `Core_Worlds_active_addEntity__action` | out: `exec`, `entity`                                             | создать entity              |
| `Core_Worlds_active_delEntity__action` | in: `entity`                                                      | удалить entity              |
| `Core_Query_add__action`               | in: `entity`                                                      | Query.add(entity)           |
| `Worlds_Add_Position__action`          | in: `entity`, `x`, `y`                                            | добавить компонент position |
| `Worlds_Add_Sprite__action`            | in: `entity`, `texture`; fields: `offsetX/offsetY/width/height`   | компонент sprite            |
| `Worlds_Add_Component_Fields__action`  | fields: `component` + произвольные поля (`spawn_count: 1`)        | компонент с полями          |

### `__getter` — чистые данные (без exec), вычисляются pull-образом

| schemaId                                                | in → out                                 | fields                  |
| ------------------------------------------------------- | ---------------------------------------- | ----------------------- |
| `Add__getter` / `Subtract__getter` / `Multiply__getter` | `a`, `b` → `result`                      | дефолты `a`, `b`        |
| `Less__getter`                                          | `a`, `b` → `result`                      | дефолт `b`              |
| `Make_Vector2__getter`                                  | `x`, `y` → `vector`                      |                         |
| `Vector2_X__getter` / `Vector2_Y__getter`               | `vector` → `x` / `y`                     |                         |
| `Camera_Camera_X__getter` / `..._Y__getter`             | → `value`                                |                         |
| `Inputs_Cursor_X__getter` / `..._Y__getter`             | → `value`                                |                         |
| `Inputs_Action_Pressed__getter`                         | → `value` (bool)                         | `action: "click"`       |
| `Core_Math_getDistance__getter`                         | `x1,y1,x2,y2` → `value`                  |                         |
| `Worlds_Get_Component__getter`                          | `entity` → поля компонента (`x`, `y`...) | `component: "position"` |
| `Assets_Image_Asset__getter`                            | → `texture`                              | `name: "gold_blink"`    |

Именование: `<Модуль>_<Метод_или_путь>__<тип>`, слова через `_`
(`Core_Worlds_active_addEntity` = `Core.Worlds.active.addEntity`).

## fieldValues

Три роли:

1. **Дефолты входных data-портов**: если порт не подключён линком — берётся
   значение из `fieldValues` (`{"a": 1, "b": "10"}`; строки с числом — коерсить в number).
2. **Конфигурация ноды**: `action`, `query`, `component`, `name`, `offsetX`, `method`,
   `params`, `returns`, `properties`.
3. **`_note`** — комментарий из редактора, игнорировать.

Типы данных портов (из `Method__event.params[].type`): `vector2`, number, bool, texture,
entity, exec... (уточнять по новым образцам).

## Модель выполнения (для интерпретатора)

1. **Exec-поток**: от event-ноды по exec-линкам. `Branch` — по `condition` в `true`/`false`.
   `For_Each_Entity` — выполняет `body`-цепочку для каждой entity из `Query.get(query)`,
   `entity` out-порт — текущая entity итерации.
2. **Data-порты — pull**: значение порта вычисляется рекурсивно по входящему линку
   (getter-ноды чистые, можно мемоизировать в рамках одного exec-импульса;
   entity-зависимые — в контексте текущей entity цикла).
3. **Неподключённый data-вход** = `fieldValues[portName]` (с коерсией типа).
4. **Модули** (modules/\*.json): `Method__event` объявляет функцию; вызов из других
   графов — нодой вида `<Module>_<method>__action/getter` (предположительно);
   `Return__action.value` — результат.

## Открытые вопросы (дособрать образцы)

- Порты `For_Each_Entity` кроме `body`/`entity` (`completed`?)
- Вызов методов модулей из других графов — schemaId и порты
- Типы портов полностью (enum?) и коерсия строк→чисел
- `On_*` события: полный список (On*Start, On_System_Update, клики UI `ui*\*`?)
- Как объявляются кастомные компоненты (`spawnerData` — поля?)

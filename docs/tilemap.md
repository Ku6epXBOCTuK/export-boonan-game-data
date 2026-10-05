# Tilemap — формат `maps/*.json`

Тайловая карта: слои-тайлы + слой объектов, спавнящихся в ECS.

## Верхний уровень

```json
{
  "cols": 25,
  "rows": 19,
  "tileSize": 32,
  "tilesets": [ ... ],
  "layers": [ ... ],
  "objects": [ ... ]
}
```

- `cols`, `rows` — размер сетки; `width = cols * tileSize`, `height = rows * tileSize`.
- `offset` — не из JSON, ставится кодом: `Map.setOffset(x, y)` (сдвиг всей карты в мире).

## tilesets

```json
"tilesets": [
  {
    "id": "tiles",
    "relativePath": "tiles.png",
    "cellSize": 32,
    "imageW": 256,
    "imageH": 256
  }
]
```

- Картинка грузится из `<папка_карты_с_заменой_maps→img>/<relativePath>`
  (правило `_sibling`: `/maps/...` → `/img/...`; если путь не содержит `/maps/` — `/public/img/`).
  Сегменты пути URL-энкодятся.
- `gridW = floor(imageW / cellSize)`, `gridH = floor(imageH / cellSize)` — сетка тайлов в атласе.
- Индекс тайла `n`: `srcX = (n % gridW) * cellSize`, `srcY = floor(n / gridW) * cellSize`.
- Допускается `tileset` (одиночный объект) вместо массива `tilesets`.
- Тайлсет без `relativePath` пропускается с варнингом.

## layers

```json
"layers": [
  {
    "id": "ground",
    "name": "Layer 1",
    "type": "tiles",
    "visible": true,
    "cells": [
      ["3,5", "tiles_t_12"],
      ["3,6", { "tileId": "tiles_t_7", "tilesetId": "tiles" }]
    ]
  },
  { "type": "entities", "name": "spawn" }
]
```

- `type`: `"tiles"` (по умолчанию) или `"entities"`. Первый слой типа `entities`
  задаёт `splitIndex`: `drawBelow()` рисует слои выше него, `drawAbove()` — ниже
  (разделение «под сущностями / над сущностями»).
- `cells` — список `["<col>,<row>", tile]`:
  - координаты парсятся из строки через запятую; вне сетки — пропуск;
  - `tile` — строка вида `"<tileset>_t_<n>"` (берётся число после `_t_`) или число;
    объект `{tileId, tilesetId}` — с явным тайлсетом, иначе первый загруженный;
  - falsy `tileId` (пустое/`0`?) — клетка пропускается; пустая клетка = `-1` в сетке.
- Рендер: только видимые клетки (`_viewCells` по камере+viewport/zoom), слои рисуются
  сверху вниз (последний слой — самый нижний), `visible: false` — пропуск.

## objects

```json
"objects": [
  {
    "name": "spawn_point",
    "visible": true,
    "x": 64, "y": 128,
    "w": 32, "h": 32,
    "sprite":  { "tileId": "tiles_t_3", "tilesetId": "tiles", "cols": 1, "rows": 1 },
    "collider": { "type": "rect", "dynamic": false },
    "components": { "enemy": { "hp": 3 } },
    "defId": "slime"
  }
]
```

Спавн в активный ECS-world при загрузке (`_buildObjects`):

1. **position** — центр: `x + offset.x + collider.cx` (без коллайдера — `w/2`), аналогично y.
2. **sprite** — если есть `sprite.tileId`: вырезается подкартинка `cellSize*cols × cellSize*rows`
   из атласа (кэшируется в Assets под ключом `map:<path>:<n>:<cols>x<rows>`);
   `offset` спрайта = сдвиг от левого верха объекта до центра position.
3. **collider** — инлайн (`collider: {type: "rect"|"circle", dynamic}`):
   - rect → компонент `colliderRect` `{width: w, height: h, dynamic}`, центр = `w/2, h/2`;
   - circle → `colliderCircle` `{radius: min(w,h)/2, dynamic}`.
4. **defId** — пресет: догружается `<папка_карты_с_maps→objects>/<defId>.json`
   (`_sibling(..., "objects")`), формат:

   ```json
   {
     "size": { "w": 32, "h": 32 },
     "colliders": [
       { "type": "rect", "x": 0, "y": 0, "w": 32, "h": 32 },
       { "type": "circle", "x": 16, "y": 16, "r": 10 }
     ]
   }
   ```

   Координаты/размеры коллайдеров пресета масштабируются на фактический размер объекта
   (`w/size.w`, `h/size.h`). Берётся **первый валидный** коллайдер из списка.
   Типы кроме `rect`/`circle` пропускаются с варнингом.

5. **components** — произвольные компоненты: `{"имя": {...props}}`; если класс компонента
   зарегистрирован (`Map.setComponents({...})`), создаётся `new Класс(props)`,
   иначе — поверхностная копия props.

Объект с `visible: false` не спавнится. Ссылка на entity пишется обратно в объект
(`object.entity`), доступ через `Map.getObject(name)` / `Map.getEntity(name)`.

## API движка

```js
Map.onLoad(fn);                    // колбэк(и) после полной загрузки
await Map.load("level_1", "./maps/level_1.json"); // url опционален:
                                   // дефолт "/public/maps/<name>.json"
Map.unload();                      // удаляет заспавненные entity из мира и Query
Map.draw();                        // все слои (на слой "world", если не передан)
Map.drawBelow(); Map.drawAbove();  // относительно слоя "entities"

Map.worldToCell(x, y);             // -> {col, row}
Map.cellToWorld(col, row);         // -> {x, y} центр клетки
Map.inBounds(col, row);
Map.hasTile(col, row, layerName?); // есть ли непустая клетка (в слое/везде)
Map.getObjects(); Map.getObject(name); Map.getEntity(name);
Map.setComponents({ enemy: EnemyClass, ... });
Map.setOffset(x, y);
```

Сигнал: после загрузки эмитится `Signals.emit("map-loaded", map)`.

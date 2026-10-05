# UI Scene — формат `ui/*.json`

Retained-UI поверх canvas: сцена — дерево нод с анкорной раскладкой, фоном, текстом
и click-событиями.

## Верхний уровень

```json
{
  "schema": 1,
  "type": "ui-scene",
  "canvas": { "width": 800, "height": 600 },
  "nodes": [ ... ]
}
```

`canvas` — логический размер сцены. Вся раскладка считается в этих координатах,
потом canvas растягивается на viewport (CSS `100vw/100vh`). Рендерится на слой `"ui"`.

## Нода

| Поле              | Тип                      | Описание                                              |
| ----------------- | ------------------------ | ----------------------------------------------------- |
| `id`              | string                   | уникальный id, на него ссылается `parent` и события   |
| `name`            | string                   | человекочитаемое имя из редактора                     |
| `parent`          | string\|null             | id родителя; раскладка считается внутри rect родителя |
| `isGroup`         | bool                     | группа — сама не рисуется, только рамка для детей     |
| `clip`            | bool                     | обрезать детей по своему rect                         |
| `locked`          | bool                     | редакторное, в рантайме игнорируется                  |
| `rotation`        | number                   | поворот в градусах вокруг центра                      |
| `width`, `height` | number                   | размер ноды (если не stretch)                         |
| `clampWidth`      | bool                     | —                                                     |
| `anchor`          | object                   | раскладка, см. ниже                                   |
| `stretch`         | `{horizontal, vertical}` | растянуться между противоположными анкорами           |
| `background`      | object                   | заливка/обводка/скругление                            |
| `slice`           | object                   | 9-slice для текстурированного фона                    |
| `texture`         | string\|null             | ключ текстуры из Assets (`frame` — источник в атласе) |
| `text`            | object                   | текст внутри ноды                                     |
| `click`           | object                   | интерактивность, см. ниже                             |

## anchor

```json
"anchor": {
  "direction": "center-top",
  "left":   { "value": 50,  "type": "percent" },
  "right":  { "value": 10,  "type": "percent" },
  "top":    { "value": 400, "type": "pixel"   },
  "bottom": { "value": 10,  "type": "percent" }
}
```

- `direction` = `<x>-<y>`: x ∈ `left|center|right`, y ∈ `top|mid|bot`
  (парсер нормализует: первое слово — горизонталь, второе — вертикаль;
  `bottom` сокращается до `bot`, `middle` → `mid`; мусор → `left-top`).
- `left/right/top/bottom` — отступы от соответствующих сторон **родителя**.
  `percent` = `value/100 * размер_родителя`, `pixel` = значение как есть.

### Раскладка (точный алгоритм из `_rectIn`)

```txt
L = resolve(left, parent.w);  R = resolve(right, parent.w)
T = resolve(top,  parent.h);  B = resolve(bottom, parent.h)

если stretch.horizontal:   x = L; w = max(0, parent.w - L - R)
иначе:                   w = node.width;  x = L - dirX * w

если stretch.vertical:     y = T; h = max(0, parent.h - T - B)
иначе:                   h = node.height; y = T - dirY * h

dirX: left=0, center=0.5, right=1
dirY: top=0,  mid=0.5,    bot=1

итог: rect = { parent.x + x, parent.y + y, w, h } — всё округляется
```

Т.е. без stretch `left/top` — это позиция «якорной точки» ноды, а `direction`
задаёт, какая точка ноды ей соответствует (для `center-top` x — середина ноды).

## background

```json
"background": {
  "enabled": true,
  "fillColor": "#1a1a2e",
  "strokeColor": "#000000",
  "strokeThickness": 0,
  "corners": { "topLeft": 0, "topRight": 0, "bottomRight": 0, "bottomLeft": 0 }
}
```

Скругления — в px, по углам, клампятся до `min(w/2, h/2)`.

## slice (9-slice)

```json
"slice": { "enabled": false, "left": 0, "right": 0, "top": 0, "bottom": 0 }
```

При `enabled` текстура фона режется на 9 частей с нерастягиваемыми краями.

## text

```json
"text": {
  "enabled": true,
  "string": "Начать игру",
  "offsetX": 0, "offsetY": 0,
  "fontFamily": "Roboto, sans-serif",
  "fontSize": 16,
  "color": "#ffffff",
  "align": "center",
  "valign": "mid",
  "lineHeight": 1.2,
  "wrap": true
}
```

Многострочность — через `\n` или перенос по ширине при `wrap`.

## click

```json
"click": {
  "enabled": true,
  "event": "ui_start_game",
  "texture": "",
  "fillColor": "",
  "strokeColor": "",
  "textColor": "",
  "scale": 1
}
```

- При клике по ноде движок делает `Signals.emit(<event>, null)` — игровой код
  подписывается: `Signals.on("ui_start_game", ...)`. Конвенция имён: `ui_*`.
- Остальные поля — визуальный фидбек наведения/нажатия: смена цветов/текстуры,
  `scale` — масштаб при нажатии (1 = без изменений).
- Хит-тест по итоговому rect (с учётом rotation), hover/pressed состояния
  хранятся на ноде.

## API движка

```js
UIScene.setCanvas(Renderer.getLayer("ui")); // куда рисовать
UIScene.load("main_menu", "./ui/main_menu.json"); // загрузить и показать
UIScene.unload(); // скрыть/очистить
UIScene.update(dt); // каждый тик
```

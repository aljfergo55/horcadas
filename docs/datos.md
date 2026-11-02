# Datos reales para Horcadas (relieve y rutas)

La web arranca con datos **sintéticos** (`npm run data:placeholder`). Esta guía los sustituye por el relieve real y tus rutas. Todo lo que genera va a `public/data/`.

Estado de las herramientas: `dem-to-heightmap.mjs` y `gpx-to-routes.mjs` están probados (ver abajo). Los comandos de **GDAL/QGIS** son estándar pero no los he podido ejecutar en el entorno de desarrollo, así que revísalos con tus datos.

## Zona de Horcadas (valores listos para usar)

- Punto central (pueblo): **42,941826 N, 5,044586 O** (WGS84, facilitado por el autor del proyecto).
- Recuadro de unos 9,8 × 10 km centrado en el pueblo, en grados: **oeste −5,104586 · sur 42,896826 · este −4,984586 · norte 42,986826**. Incluye Carande, el Puerto de Horcadas y el valle; el borde noreste queda cerca de Riaño.
- Con `-ts 1025 1025` la celda del heightmap es de ≈ 9,5 m. El MDT05 original es de 5 m; si quieres más detalle usa `-ts 1537 1537` (≈ 6,4 m, heightmap de ≈ 9 MB).

**Vía directa, sin GDAL (la que se usa en este proyecto).** Las hojas del CNIG se descargan como GeoTIFF; este script las lee tal cual, recorta el recuadro de Horcadas y genera el relieve:

```bash
npm run data:geotiff -- etc/PNOA_MDT05_ETRS89_HU30_0105_LID.tif
```

Admite varias hojas a la vez (si el recuadro cae entre dos), `--bbox O,S,E,N` y `--size N`. Acepta TIFF clásico y BigTIFF, float32 sin compresión o Deflate, y UTM ETRS89 (EPSG:258xx) o grados. La hoja MDT05 **0105** cubre el recuadro entero. Resultado validado contra un recorte independiente descargado del IGN: diferencia media de 0,25 m en 400 puntos.

Alternativa con GDAL, por si prefieres controlar el proceso. Comandos completos, ya con estos valores:

```bash
# 1. Unir las hojas descargadas del CNIG (MDT05 o MDT02; .asc o .tif)
gdalbuildvrt data-raw/mdt.vrt data-raw/*MDT*.asc

# 2. Recortar a WGS84
gdalwarp -t_srs EPSG:4326 -te -5.104586 42.896826 -4.984586 42.986826 \
  -ts 1025 1025 -r bilinear data-raw/mdt.vrt data-raw/recorte.tif

# 3. A ASCII Grid, y de ahí al relieve de la web
gdal_translate -of AAIGrid data-raw/recorte.tif data-raw/horcadas.asc
npm run data:dem -- data-raw/horcadas.asc

# 4. Ortofoto del mismo recuadro
npm run data:ortho
```

## 1. Descargar el MDT y la ortofoto (CNIG / IGN)

1. Entra en el [Centro de Descargas del CNIG](https://centrodedescargas.cnig.es).
2. **Modelos digitales de elevaciones → MDT05** (malla de 5 m, toda España) o **MDT02** (2 m, donde esté disponible). Elige las hojas que cubran Horcadas y su entorno (conviene un margen de unos 4–6 km alrededor del pueblo).
3. **Imágenes → Ortofotos PNOA** de la misma zona (opcional; es lo que da el aspecto fotográfico al terreno).
4. Guárdalo todo en `data-raw/` (está en `.gitignore`, no se sube al repositorio).

Atribución: los datos del IGN/CNIG se publican con licencia CC-BY 4.0; la web debe citar la fuente ("© Instituto Geográfico Nacional de España").

## 2. Recortar y reproyectar a WGS84 (GDAL)

Elige el rectángulo en grados (oeste, sur, este, norte) y recorta. Se usa **EPSG:4326** a propósito: así los GPX (que vienen en lon/lat) encajan con una simple transformación lineal.

```bash
# Si hay varias hojas, primero únelas
gdalbuildvrt data-raw/mdt.vrt data-raw/MDT05-*.tif

# Recorte + reproyección a WGS84, remuestreado a ~1025 x 1025 celdas
gdalwarp -t_srs EPSG:4326 -te OESTE SUR ESTE NORTE -ts 1025 1025 \
  -r bilinear data-raw/mdt.vrt data-raw/recorte.tif

# Exportar a ASCII Grid (formato que lee nuestro script)
gdal_translate -of AAIGrid data-raw/recorte.tif data-raw/horcadas.asc
```

Con QGIS: *Ráster → Proyecciones → Warp*, y *Ráster → Conversión → Convertir (traducir)* con formato "Arc/Info ASCII Grid".

Resolución: 1025 × 1025 (≈ 4 MB en `heightmap.bin`) es un buen equilibrio. La malla 3D usa como máximo ~320 segmentos; más celdas solo mejoran el cálculo de la altura de las rutas.

## 3. Generar el heightmap

```bash
npm run data:dem -- data-raw/horcadas.asc
```

Crea `public/data/heightmap.bin` (Float32, metros) y `public/data/meta.json` (dimensiones reales, rango de cotas y `bounds` WGS84). El script se niega a continuar si el MDT no está en grados (`cellsize` > 0,1) para evitar mezclar proyecciones.

## 4. Ortofoto (opcional)

**Vía rápida:** con el relieve real ya generado (paso 3), este comando descarga la ortofoto PNOA del mismo rectángulo desde el WMS del IGN, la guarda como `public/data/ortho.jpg` y actualiza `meta.json`:

```bash
npm run data:ortho                 # 4096 x 4096 px
npm run data:ortho -- --size 2048  # si el servidor rechaza el tamaño o para móvil
```

No se ha podido probar desde el entorno de desarrollo (ign.es estaba bloqueado), así que revisa el resultado. Si prefieres el control manual, o necesitas más resolución que la que da el WMS, usa GDAL:

```bash
gdalwarp -t_srs EPSG:4326 -te OESTE SUR ESTE NORTE -ts 4096 4096 \
  data-raw/PNOA-*.tif data-raw/orto.tif
gdal_translate -of PNG data-raw/orto.tif data-raw/orto.png
cwebp -q 82 data-raw/orto.png -o public/data/ortho.webp
```

Después pon `"ortho": "data/ortho.webp"` en `public/data/meta.json`. Si ocupa demasiado para móvil, reduce a 2048 px o usa KTX2.

## 5. Rutas (GPX → routes.json)

**Importante:** el fichero GPX debe llamarse como el `id` de la ruta en `src/data/rutas.json` (`puerto-de-horcadas.gpx`, `collado-el-baile.gpx`). Así el script toma de ese catálogo el nombre, la dificultad y la descripción, y la ficha de la web muestra el botón «Ver en el relieve 3D». Los GPX originales no se suben al repositorio (`etc/` está en el `.gitignore`); solo se guarda en `routes.json` la geometría simplificada.

Graba las rutas con el móvil (o exporta los GPX de una app) y colócalos en `rutas/`:

```bash
npm run data:routes -- rutas/ruta-del-valle.gpx rutas/subida-a-la-cresta.gpx
```

- El `id` sale del nombre del fichero; el nombre visible, de la etiqueta `<name>` del GPX.
- Los puntos se aligeran (separación mínima ≈ 12 m en un mapa de 8 km) y se descartan los que caen fuera del relieve (con aviso).
- Si `routes.json` ya existía, se **conservan `difficulty`, `color` y `description`** de las rutas con el mismo `id`. Edita esos campos a mano en `public/data/routes.json`; el script solo sustituye la geometría.

## Pruebas realizadas

- `dem-to-heightmap`: rejilla sintética 513 × 513 exportada a ASCII Grid y reconvertida; diferencia máxima con el original 0,0005 m (redondeo del texto). Meta y `bounds` correctos.
- `gpx-to-routes`: GPX de prueba con entidades XML (`&amp;`), un punto fuera de la zona y puntos casi duplicados → descartado y aligerado como se espera.

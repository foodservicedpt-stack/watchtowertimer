# WatchtowerTimer

Temporizador para la reunión de estudio de *La Atalaya*. Calcula el ritmo, marca los párrafos con “lea” o imagen, redistribuye el tiempo cuando pasas de párrafo y guarda tus notas.

Es una **aplicación web progresiva (PWA)**: se publica como página web, se puede instalar en el iPad, el móvil o el ordenador y funciona sin conexión.

## Publicar en GitHub Pages

La app se despliega automáticamente con GitHub Actions:

1. Sube este repositorio a GitHub.
2. En **Settings → Pages**, elige *Source: GitHub Actions* (el workflow `deploy.yml` ya lo configura).
3. Al terminar la primera ejecución, la app estará en `https://TU-USUARIO.github.io/watchtowertimer/`.

El workflow:
- Se ejecuta en cada *push* a `main`.
- Se ejecuta cada **lunes** para descargar el artículo de estudio de la semana desde jw.org y publicarlo.
- Se puede lanzar manualmente desde **Actions → Deploy to GitHub Pages → Run workflow**.

## Cómo funciona el artículo semanal

La versión publicada lee `article.json`, que el despliegue refresca automáticamente desde jw.org. Si no hay conexión (o jw.org no responde), usa la copia integrada y el temporizador sigue funcionando igual.

Para refrescar `article.json` localmente:

```sh
node scripts/fetch-article.mjs
```

## Ejecutar en local

Opción A — estática (sin actualización automática): abre `index.html` o sirve la carpeta con cualquier servidor estático.

Opción B — con servidor Node y actualización automática:

```sh
node server.mjs
```

Abre [http://localhost:4173](http://localhost:4173). El servidor consulta jw.org y sirve el artículo actual en `/article.json`. Para usarlo desde el iPad, conecta ambos dispositivos a la misma red Wi‑Fi y abre `http://IP-DEL-MAC:4173`.

## Instalar como PWA

- **iPad / iPhone (Safari):** abre la página → Compartir → *Añadir a pantalla de inicio*.
- **Android / Chrome:** abre la página → menú → *Instalar app*.
- **Ordenador (Chrome/Edge):** icono de instalación en la barra de direcciones.

## Iconos

Los iconos se generan con `node scripts/generate-icons.mjs` (sin dependencias) y quedan en `icons/`.

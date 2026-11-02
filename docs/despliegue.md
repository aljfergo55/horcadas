# Despliegue en Cloudflare Pages con horcadas.es

1. Sube el repositorio a GitHub (`git push -u origin main`).
2. En [Cloudflare](https://dash.cloudflare.com) → *Workers & Pages* → *Create* → *Pages* → *Connect to Git* → elige `horcadas`.
3. Configuración de compilación: framework **Astro**, comando `npm run build`, directorio de salida `dist`, variable `NODE_VERSION` = `22`.
4. Tras el primer despliegue, en el proyecto → *Custom domains* → añade `horcadas.es` y `www.horcadas.es`.
5. Dominio en DonDominio: Cloudflare ofrece dos vías.
   - **Recomendada:** añade `horcadas.es` como sitio en Cloudflare (plan gratis); te dará dos *nameservers*. En DonDominio → Dominios → horcadas.es → Servidores DNS, sustituye los actuales por los de Cloudflare. Cloudflare crea los registros del dominio solo.
   - **Sin cambiar DNS:** en el DNS de DonDominio crea un `CNAME` de `www` a `<proyecto>.pages.dev` y redirige el dominio raíz a `www` (el raíz no admite CNAME en la mayoría de DNS).
6. Activa *Always Use HTTPS* en Cloudflare y espera unos minutos al certificado.
7. Comprueba que `https://horcadas.es` carga y que `www` redirige al dominio sin www.
8. Activa la renovación automática del dominio en DonDominio.

Opcional más adelante: correo `@horcadas.es` con *Email Routing* de Cloudflare (gratis, reenvía a tu correo) y alta del sitio en Google Search Console.

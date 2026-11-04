# SRV POS

Punto de venta web en Node.js y PostgreSQL. Se creó en una carpeta independiente porque `SRV.exe` es un ejecutable y en la carpeta original no se encontró el código fuente del sistema. Este proyecto se conecta directamente a PostgreSQL.

Incluye catálogo de productos, existencias, clientes vinculados a las ventas, ventas con descuento de inventario transaccional, métodos de pago, apertura y cierre de caja, ventas recientes e indicadores del día. Los reportes de ventas y clientes se pueden filtrar por fechas; el reporte de ventas también permite filtrar por cliente. Ambos reportes se pueden descargar como archivos Excel `.xlsx` e imprimir desde el navegador. Los tickets de ventas nuevas y anteriores se pueden consultar e imprimir. Las fechas de los reportes siguen la zona horaria configurada en el equipo donde se ejecuta Node.js.

La tasa de impuestos es configurable; por defecto es 0 para no asumir una tasa fiscal.

## Requisitos

- Node.js 20 o posterior.
- PostgreSQL 14 o posterior, accesible desde esta máquina.
- Un usuario PostgreSQL con permisos para crear tablas, índices y consultar la base seleccionada.

## Instalación

1. Crea una base de datos PostgreSQL, por ejemplo `pos_node`, y un usuario con permisos sobre ella. En `psql`, por ejemplo:
   ```sql
   CREATE ROLE pos_user LOGIN PASSWORD 'cambia-esta-clave';
   CREATE DATABASE pos_node OWNER pos_user;
   ```
2. Desde esta carpeta, ejecuta `npm install`.
3. Copia `.env.example` a `.env` y configura `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` y `DB_PASSWORD`.
4. Para una conexión PostgreSQL con TLS, configura `DB_SSL=true`. `DB_SSL_REJECT_UNAUTHORIZED=false` solo es adecuado para pruebas con certificados autofirmados; en producción, conserva la verificación habilitada.
5. Ejecuta `npm run db:init` para crear las tablas e índices.
6. Ejecuta `npm start` y abre `http://127.0.0.1:3000`.

El servidor escucha en `127.0.0.1` por defecto. Cambia `HOST` únicamente si necesitas permitir conexiones desde otros dispositivos y has configurado controles de acceso adecuados. La aplicación inicial no incluye autenticación de usuarios.

## Impuestos

`POS_TAX_RATE` representa una tasa decimal entre `0` y `1`; por ejemplo, `0.16` calcula un 16 %. El valor predeterminado es `0`.

## Pruebas

El script `db/schema.sql` es propio de PostgreSQL y no importa los scripts SQL Server de la carpeta original.

Ejecuta `npm test` para probar validaciones de productos y ventas.

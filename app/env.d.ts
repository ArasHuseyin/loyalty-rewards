/// <reference types="vite/client" />

// Vite ?raw imports — yaml/text/etc. resolved at build time as a string.
declare module "*.yaml?raw" {
  const content: string;
  export default content;
}
declare module "*.yml?raw" {
  const content: string;
  export default content;
}

// Vite ?url imports — resolves the asset to its built URL string. Used by
// app/routes/app._index.tsx for the Polaris stylesheet href.
declare module "*.css?url" {
  const href: string;
  export default href;
}

import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import { nanoid } from "nanoid";

const viteLogger = createLogger();

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  
  // In development, explicitly serve only static assets that are not handled by Vite
  // so that Vite can still inject its preamble into index.html.
  const clientPath = path.resolve(import.meta.dirname, "..", "client");
  
  // PWA assets
  app.get(["/manifest.webmanifest"], (_req, res) => {
    res.sendFile(path.resolve(clientPath, "manifest.webmanifest"));
  });
  app.get(["/favicon.ico"], (_req, res) => {
    res.sendFile(path.resolve(clientPath, "favicon.ico"));
  });
  app.get(["/sw.js"], (_req, res) => {
    res.sendFile(path.resolve(clientPath, "sw.js"));
  });
  
  // Icons and screenshots directories
  app.use("/icons", express.static(path.resolve(clientPath, "icons")));
  app.use("/screenshots", express.static(path.resolve(clientPath, "screenshots")));
  
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(import.meta.dirname, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // Ensure critical PWA assets resolve even if not emitted to dist/public
  // Serve from source client directory as a fallback in production
  const clientPath = path.resolve(import.meta.dirname, "..", "client");
  app.get(["/manifest.webmanifest"], (_req, res, next) => {
    const filePath = path.resolve(distPath, "manifest.webmanifest");
    fs.existsSync(filePath)
      ? res.sendFile(filePath)
      : res.type("application/manifest+json").sendFile(path.resolve(clientPath, "manifest.webmanifest"));
  });
  app.get(["/favicon.ico"], (_req, res, next) => {
    const filePath = path.resolve(distPath, "favicon.ico");
    fs.existsSync(filePath)
      ? res.sendFile(filePath)
      : res.sendFile(path.resolve(clientPath, "favicon.ico"));
  });
  app.get(["/sw.js"], (_req, res, next) => {
    const filePath = path.resolve(distPath, "sw.js");
    fs.existsSync(filePath)
      ? res.sendFile(filePath)
      : res.type("application/javascript").sendFile(path.resolve(clientPath, "sw.js"));
  });
  app.use("/icons", express.static(fs.existsSync(path.resolve(distPath, "icons"))
    ? path.resolve(distPath, "icons")
    : path.resolve(clientPath, "icons")));
  app.use("/screenshots", express.static(fs.existsSync(path.resolve(distPath, "screenshots"))
    ? path.resolve(distPath, "screenshots")
    : path.resolve(clientPath, "screenshots")));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}

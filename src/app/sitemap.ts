import type { MetadataRoute } from "next";

const SITE_URL = "https://capital-flow-tracker.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = [
    "",
    "/report",
    "/calendar",
    "/news",
    "/indicators",
    "/reports/weekly",
    "/reports/monthly",
    "/reports/yearly",
  ];

  return staticRoutes.map((route) => ({
    url: `${SITE_URL}${route}`,
    lastModified: new Date(),
  }));
}

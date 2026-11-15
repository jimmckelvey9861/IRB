import type { MetadataRoute } from "next";

/** Lets members install the app on their phone's home screen (groundwork for the mobile experience). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "IRB",
    short_name: "IRB",
    description: "Institutional Review Board reviews and voting",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1d4ed8",
  };
}

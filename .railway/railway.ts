import { defineRailway, project, service } from "railway/iac";

// Last resort for a per-service CaC repo. Prefer one .railway file for the
// project and drop this if you later combine services into that file.
export const partial = "nexus-course";

export default defineRailway(() => {
  const nexus_course = service("nexus-course", {
    build: "",
    start: "npm start",
    healthcheck: "/api/health",
    // builder from CaC: "NIXPACKS"
  });
  return project("nexus-course", {
    resources: [nexus_course],
  });
});

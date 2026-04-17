import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  generateFeatureTreeForRepo,
  generateSurfaceIndexForRepo,
} from "../docs/framework-feature-tree-generator";

function createSpringRepoFixture(root: string): void {
  fs.mkdirSync(path.join(root, "src", "main", "java", "com", "example", "controller"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(root, "src", "main", "resources", "templates"), {
    recursive: true,
  });

  fs.writeFileSync(
    path.join(root, "pom.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>demo-blog</artifactId>
  <name>Demo Blog</name>
  <description>Spring Boot blog fixture</description>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
  </dependencies>
</project>`,
  );

  fs.writeFileSync(
    path.join(root, "src", "main", "java", "com", "example", "controller", "AdminController.java"),
    `package com.example.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;

@Controller
@RequestMapping("/admin")
public class AdminController {
    @GetMapping("/dashboard")
    public String dashboard() {
        return "/dashboard";
    }

    @PostMapping("/posts")
    public String createPost() {
        return "redirect:/admin/dashboard";
    }

    @RequestMapping(value = "/audit/{username}", method = RequestMethod.GET)
    public String audit(@RequestParam(defaultValue = "0") int page) {
        return "/audit";
    }
}
`,
  );

  fs.writeFileSync(
    path.join(root, "src", "main", "resources", "templates", "dashboard.html"),
    `<html><head><title>Admin Dashboard</title></head><body><h1>Admin Dashboard</h1></body></html>`,
  );
  fs.writeFileSync(
    path.join(root, "src", "main", "resources", "templates", "audit.html"),
    `<html><head><title>Audit Log</title></head><body><h1>Audit Log</h1></body></html>`,
  );
}

describe("framework-feature-tree-generator", () => {
  it("generates a compatible surface index for Spring Boot controllers", () => {
    const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp-framework-generator-"));

    try {
      createSpringRepoFixture(dir);

      const tree = generateFeatureTreeForRepo(dir);
      const surfaceIndex = generateSurfaceIndexForRepo(dir);

      expect(tree.framework).toBe("spring-boot");
      expect(tree.productName).toBe("Demo Blog");
      expect(surfaceIndex.pages).toEqual([
        {
          route: "/admin/audit/{username}",
          title: "Audit Log",
          description: "Spring MVC page served by AdminController#audit",
          sourceFile: "src/main/resources/templates/audit.html",
        },
        {
          route: "/admin/dashboard",
          title: "Admin Dashboard",
          description: "Spring MVC page served by AdminController#dashboard",
          sourceFile: "src/main/resources/templates/dashboard.html",
        },
      ]);
      expect(surfaceIndex.contractApis).toEqual([
        {
          domain: "admin",
          method: "GET",
          path: "/admin/audit/{username}",
          operationId: "admin.audit",
          summary: "Render Audit",
        },
        {
          domain: "admin",
          method: "GET",
          path: "/admin/dashboard",
          operationId: "admin.dashboard",
          summary: "Render Dashboard",
        },
        {
          domain: "admin",
          method: "POST",
          path: "/admin/posts",
          operationId: "admin.createPost",
          summary: "Create Post",
        },
      ]);
      expect(surfaceIndex.implementationApis).toEqual([
        {
          label: "springMvc",
          domain: "admin",
          method: "GET",
          path: "/admin/audit/{username}",
          sourceFiles: ["src/main/java/com/example/controller/AdminController.java"],
        },
        {
          label: "springMvc",
          domain: "admin",
          method: "GET",
          path: "/admin/dashboard",
          sourceFiles: ["src/main/java/com/example/controller/AdminController.java"],
        },
        {
          label: "springMvc",
          domain: "admin",
          method: "POST",
          path: "/admin/posts",
          sourceFiles: ["src/main/java/com/example/controller/AdminController.java"],
        },
      ]);
      expect(
        surfaceIndex.metadata?.features.some((feature) =>
          feature.apis?.includes("GET /admin/dashboard")
          && feature.sourceFiles?.includes("src/main/java/com/example/controller/AdminController.java"),
        ),
      ).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

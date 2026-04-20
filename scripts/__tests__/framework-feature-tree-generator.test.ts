import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseFeatureTree } from "../../src/app/api/feature-explorer/shared";
import { readFeatureSurfaceIndex } from "../../src/core/spec/feature-surface-index";
import featureSurfaceMetadata from "../../src/core/spec/feature-surface-metadata";
import {
  generateFeatureTreeForRepo,
  generateSurfaceIndexForRepo,
  renderFeatureTreeMarkdown,
  validateSurfaceIndex,
} from "../docs/framework-feature-tree-generator";

const { mergeSurfaceMetadata } = featureSurfaceMetadata;

function stripOperationIds(
  apis: Array<{ domain: string; method: string; path: string; summary: string }>,
): Array<{ domain: string; method: string; path: string; summary: string }> {
  return apis.map((api) => ({
    domain: api.domain,
    method: api.method,
    path: api.path,
    summary: api.summary,
  }));
}

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
  it("merges specialist metadata on top of persisted feature metadata", () => {
    const merged = mergeSurfaceMetadata(
      {
        schemaVersion: 1,
        capabilityGroups: [
          { id: "platform-foundation", name: "Platform Foundation" },
        ],
        features: [
          {
            id: "user-login",
            name: "User Login",
            group: "platform-foundation",
            pages: ["/login"],
            sourceFiles: ["src/main/resources/templates/login.html"],
          },
        ],
      },
      {
        schemaVersion: 1,
        capabilityGroups: [
          { id: "authentication", name: "Authentication" },
        ],
        features: [
          {
            id: "user-login",
            name: "User Login",
            group: "authentication",
            apis: ["GET /login"],
            domainObjects: ["user", "session"],
            sourceFiles: ["src/main/java/com/example/controller/LoginController.java"],
          },
          {
            id: "user-registration",
            name: "User Registration",
            group: "authentication",
            pages: ["/registration"],
          },
        ],
      },
    );

    expect(merged).toEqual({
      schemaVersion: 1,
      capabilityGroups: [
        { id: "authentication", name: "Authentication" },
        { id: "platform-foundation", name: "Platform Foundation" },
      ],
      features: [
        {
          id: "user-login",
          name: "User Login",
          group: "authentication",
          pages: ["/login"],
          apis: ["GET /login"],
          domainObjects: ["session", "user"],
          sourceFiles: [
            "src/main/java/com/example/controller/LoginController.java",
            "src/main/resources/templates/login.html",
          ],
        },
        {
          id: "user-registration",
          name: "User Registration",
          group: "authentication",
          pages: ["/registration"],
        },
      ],
    });
  });

  it("drops inferred generated features before building a new metadata seed", () => {
    const stripped = featureSurfaceMetadata.stripInferredSurfaceMetadata({
      schemaVersion: 1,
      capabilityGroups: [
        { id: "inferred-surfaces", name: "Inferred Surfaces" },
        { id: "authentication", name: "Authentication" },
      ],
      features: [
        {
          id: "login",
          name: "Login",
          group: "inferred-surfaces",
          status: "inferred",
          pages: ["/login"],
        },
        {
          id: "user-login",
          name: "User Login",
          group: "authentication",
          status: "draft",
          pages: ["/login"],
        },
      ],
    });

    expect(stripped).toEqual({
      schemaVersion: 1,
      capabilityGroups: [
        { id: "authentication", name: "Authentication" },
      ],
      features: [
        {
          id: "user-login",
          name: "User Login",
          group: "authentication",
          status: "draft",
          pages: ["/login"],
        },
      ],
    });
  });

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

  it("round-trips generic implementation APIs through generated markdown readers", async () => {
    const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp-framework-generator-"));

    try {
      createSpringRepoFixture(dir);
      fs.mkdirSync(path.join(dir, "docs", "product-specs"), { recursive: true });

      const tree = generateFeatureTreeForRepo(dir);
      const surfaceIndex = generateSurfaceIndexForRepo(dir);
      const markdown = renderFeatureTreeMarkdown(tree, surfaceIndex, dir);

      fs.writeFileSync(
        path.join(dir, "docs", "product-specs", "FEATURE_TREE.md"),
        markdown,
        "utf8",
      );

      const parsedSurfaceIndex = await readFeatureSurfaceIndex(dir);
      const parsedFeatureTree = parseFeatureTree(dir);

      expect(stripOperationIds(parsedSurfaceIndex.contractApis)).toEqual(
        stripOperationIds(surfaceIndex.contractApis),
      );
      expect(parsedSurfaceIndex.implementationApis).toEqual(surfaceIndex.implementationApis);
      expect(parsedFeatureTree.implementationApiEndpoints).toEqual([
        {
          label: "springMvc",
          group: "admin",
          method: "GET",
          endpoint: "/admin/audit/{username}",
          sourceFiles: ["src/main/java/com/example/controller/AdminController.java"],
        },
        {
          label: "springMvc",
          group: "admin",
          method: "GET",
          endpoint: "/admin/dashboard",
          sourceFiles: ["src/main/java/com/example/controller/AdminController.java"],
        },
        {
          label: "springMvc",
          group: "admin",
          method: "POST",
          endpoint: "/admin/posts",
          sourceFiles: ["src/main/java/com/example/controller/AdminController.java"],
        },
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("validates feature metadata references against declared Spring surfaces", () => {
    const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp-framework-generator-"));

    try {
      createSpringRepoFixture(dir);

      const surfaceIndex = generateSurfaceIndexForRepo(dir);
      surfaceIndex.metadata = {
        schemaVersion: 1,
        capabilityGroups: [{ id: "content-management", name: "Content Management" }],
        features: [
          {
            id: "broken-feature",
            name: "Broken Feature",
            group: "missing-group",
            pages: ["/missing"],
            apis: ["GET /missing"],
          },
        ],
      };

      const validation = validateSurfaceIndex(surfaceIndex);
      expect(validation.errors).toEqual([
        'Feature "broken-feature" references missing capability group "missing-group".',
        'Feature "broken-feature" references undeclared api "GET /missing".',
        'Feature "broken-feature" references undeclared page "/missing".',
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

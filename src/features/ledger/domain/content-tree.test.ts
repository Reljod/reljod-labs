import { describe, expect, it } from "vitest";
import { experience } from "@/content/experience";
import { featuredProjects } from "@/content/projects";
import { blockText, contentTree, describeContentTree } from "./content-tree";
import { sourcePath } from "./source-paths";

describe("contentTree", () => {
  it("names every job, every job point and the contact card", () => {
    experience.forEach((job, index) => {
      expect(contentTree.get(sourcePath.job(index))?.block).toMatchObject({
        kind: "job",
        company: job.company,
      });
      job.points.forEach((_, point) => {
        expect(contentTree.has(sourcePath.jobPoint(index, point))).toBe(true);
      });
    });
    expect(contentTree.get(sourcePath.contact)?.block.kind).toBe("contact");
  });

  it("only offers the projects the page shows", () => {
    expect(
      contentTree.has(sourcePath.project(featuredProjects.length - 1)),
    ).toBe(true);
    expect(contentTree.has(sourcePath.project(featuredProjects.length))).toBe(
      false,
    );
  });

  it("lets only quotes be cut down to an excerpt", () => {
    for (const node of contentTree.values()) {
      expect(node.excerptable).toBe(node.block.kind === "quote");
    }
  });

  it("describes each source on one line for the model", () => {
    const lines = describeContentTree().split("\n");
    expect(lines).toHaveLength(contentTree.size);
    const kycLine = lines.find((line) =>
      line.startsWith(`${sourcePath.jobPoint(3, 0)} |`),
    );
    expect(kycLine).toContain("(excerptable)");
    expect(kycLine).toContain("90% lower KYC operating cost");
  });

  it("keeps the site's words in every block", () => {
    const highlight = contentTree.get(sourcePath.highlight(0));
    if (!highlight) throw new Error("missing highlight");
    expect(blockText(highlight.block)).toContain("7 yrs");
  });
});

import type { LoupePorts } from "../ports";
import { type ConnectService, createConnectService } from "./connect";
import { createEnding } from "./ending";
import {
  createExaminationService,
  type ExaminationService,
} from "./examinations";
import { createExaminerService, type ExaminerService } from "./examiner";
import { createRulebookService, type RulebookService } from "./rulebooks";
import { createShared } from "./shared";
import { createToolService, type ToolService } from "./tools";
import { createUploadService, type UploadService } from "./uploads";

/**
 * Loupe's services, one per area. The REST routes, the MCP server, the
 * workflow steps and the page reach Loupe's data only through these.
 */
export type LoupeServices = {
  examinations: ExaminationService;
  rulebooks: RulebookService;
  uploads: UploadService;
  connect: ConnectService;
  /** The Examiner's tools, for the MCP server and "run the Check again". */
  tools: ToolService;
  /** The workflow's side of an Examination, for its steps. */
  examiner: ExaminerService;
};

export function createLoupeServices(ports: LoupePorts): LoupeServices {
  const shared = createShared(ports);
  const ending = createEnding({ ...ports, shared });
  return {
    examinations: createExaminationService({ ...ports, shared, ending }),
    rulebooks: createRulebookService(ports),
    uploads: createUploadService(ports),
    connect: createConnectService(ports),
    tools: createToolService({ ...ports, shared, ending }),
    examiner: createExaminerService({ ...ports, shared, ending }),
  };
}

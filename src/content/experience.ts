import type { Credential, Experience } from "./types";

export const experience: Experience[] = [
  {
    role: "AI Consultant",
    company: "Acquire Intelligence",
    location: "Remote · Australia",
    period: "Jul 2026 – Present",
    sector: "Consulting",
    points: [
      "Senior AI engineer on client engagements, owning each solution from problem framing through architecture, implementation and deployment.",
      "Build AI agents and AI-powered services in Python and FastAPI, integrated with clients' existing applications and data platforms.",
    ],
    stack: ["Python", "FastAPI", "AI agents"],
  },
  {
    role: "Full Stack Python Engineer / AI Engineer",
    company: "Cloud Employee",
    location: "Remote",
    period: "Dec 2025 – Jun 2026",
    sector: "AI SaaS",
    points: [
      "Designed a multi-agent eligibility pipeline on AWS Lambda that screens out 95 to 97 percent of ineligible records before report generation.",
      "Ran asynchronous agent workflows on Celery, Docker and AWS EKS, serving compliance, finance and KYC use cases from one shared agent framework.",
      "Turned operational problems from product and business stakeholders into agent designs, with success criteria and evaluation checks defined before each release.",
    ],
    stack: ["CrewAI", "LangGraph", "AWS Bedrock", "LangFuse"],
  },
  {
    role: "AI Engineer",
    company: "Spark Intelligence, Inc.",
    location: "Remote",
    period: "May 2025 – Nov 2025",
    sector: "AI SaaS",
    points: [
      "Built a full-stack multi-tenant AI SaaS product with agent logic in LangChain and LangGraph over GPT, Gemini and Grok.",
      "Engineered a fault-tolerant AI pipeline on Modal and Trigger.dev so long-running inference jobs recovered without dropping tenant workloads.",
      "Improved output quality with LangFuse tracing, DSPy prompt optimization and DeepEval custom metrics.",
    ],
    stack: ["Next.js", "Supabase", "DSPy", "DeepEval"],
  },
  {
    role: "Senior Software Engineer",
    company: "Maya Philippines, Inc.",
    location: "Taguig, Philippines",
    period: "Mar 2022 – Apr 2025",
    sector: "Banking",
    highlight: true,
    points: [
      "Partnered with data science to replace a costly third-party KYC vendor with an in-house AI solution: 90% lower KYC operating cost, +7 pts approval rate, +8 pts automation rate.",
      "Core engineer on the User Profiles team of a leading Philippine digital bank and wallet, across Node.js, FastAPI, Spring Boot and AWS serverless.",
      "Built fault-tolerant data pipelines on Firehose, S3, Aurora and Databricks to feed analytics and model training.",
    ],
    stack: ["KYC", "AWS", "FastAPI", "Databricks"],
  },
  {
    role: "Software Engineer III",
    company: "FactSet Philippines, Inc.",
    location: "Taguig, Philippines",
    period: "Feb 2020 – Mar 2022",
    sector: "Financial data",
    points: [
      "Led the integration of FactSet's Revere finance data, running stakeholder meetings and reporting delivery timelines to management.",
      "Migrated legacy Perl and C++ data pipelines to C# ASP.NET, and automated manual data ingestion with an internal tool.",
    ],
    stack: ["C#", "MSSQL", "Python", "Vue.js"],
  },
  {
    role: "Prototype Engineer",
    company: "Yuro Product Development and Design Solutions",
    location: "Manila, Philippines",
    period: "Jun 2019 – Feb 2020",
    sector: "Hardware",
    points: [
      "Built a computer vision prototype for tennis officiating with OpenCV, YOLO and PyTorch.",
      "Designed the AWS IoT Core architecture for a connected hardware product.",
    ],
    stack: ["OpenCV", "PyTorch", "AWS IoT"],
  },
];

export const credentials: Credential[] = [
  {
    title: "BS Electronics Engineering",
    detail:
      "Polytechnic University of the Philippines, Manila · DOST Scholar, 2014–2019",
  },
  {
    title: "Licensed Electronics Engineer (ECE)",
    detail: "Philippine Professional Regulation Commission, 2019",
  },
];

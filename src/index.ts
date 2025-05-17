import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { env } from "cloudflare:workers";

export interface Env {
  GITHUB_PAT: string;
}

interface GitHubPR {
  title: string;
  html_url: string;
  created_at: string;
  state: string;
}

interface GitHubAPIResponse {
  items: GitHubPR[];
  total_count: number;
  incomplete_results: boolean;
}

interface ToolParams {
  startDate: string;
  endDate: string;
  githubUsername: string;
}

interface ToolExtra {
  env: Env;
}

// Define our MCP agent with tools
export class MyMCP extends McpAgent {
  server = new McpServer({
    name: "Crazy",
    version: "1.0.0",
    env: (env: Env) => env,
  });

  async init() {
    // Simple addition tool
    this.server.tool(
      "add",
      { a: z.number(), b: z.number() },
      async ({ a, b }) => ({
        content: [{ type: "text", text: String(a + b) }],
      })
    );

    // Calculator tool with multiple operations
    this.server.tool(
      "calculate",
      {
        operation: z.enum(["add", "subtract", "multiply", "divide"]),
        a: z.number(),
        b: z.number(),
      },
      async ({ operation, a, b }) => {
        let result: number;
        switch (operation) {
          case "add":
            result = a + b;
            break;
          case "subtract":
            result = a - b;
            break;
          case "multiply":
            result = a * b;
            break;
          case "divide":
            if (b === 0)
              return {
                content: [
                  {
                    type: "text",
                    text: "Error: Cannot divide by zero",
                  },
                ],
              };
            result = a / b;
            break;
        }
        return { content: [{ type: "text", text: String(result) }] };
      }
    );

    // GitHub PRs tool
    this.server.tool(
      "github-prs",
      {
        startDate: z.string().datetime(),
        endDate: z.string().datetime(),
        githubUsername: z.string(),
      },
      async (args, extra) => {
        const { startDate, endDate, githubUsername } = args;
        const githubToken = '';
        if (!githubToken) {
          return {
            content: [
              {
                type: "text",
                text: "Error: GitHub PAT not found in environment variables",
              },
            ],
          };
        }

        const url = `https://api.github.com/search/issues?q=author:${githubUsername}+type:pr+created:${startDate}..${endDate}`;
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: "application/vnd.github.v3+json",
            'User-Agent': 'remote-mcp-server-authless',
          },
        });

        if (!response.ok) {
          const error = await response.text();
          return {
            content: [
              {
                type: "text",
                text: `Error fetching PRs: ${error}`,
              },
            ],
          };
        }

        const data = (await response.json()) as GitHubAPIResponse;
        const prs = data.items.map((pr: GitHubPR) => ({
          title: pr.title,
          url: pr.html_url,
          createdAt: pr.created_at,
          state: pr.state,
        }));

        return {
          content: [
            {
              type: "text",
              text: `Found ${prs.length} PRs for ${githubUsername} between ${startDate} and ${endDate}:`,
            },
            {
              type: "text",
              text: JSON.stringify(prs, null, 2),
            },
          ],
        };
      }
    );
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      // @ts-ignore
      return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
    }

    if (url.pathname === "/mcp") {
      // @ts-ignore
      return MyMCP.serve("/mcp").fetch(request, env, ctx);
    }

    return new Response("Not found", { status: 404 });
  },
};

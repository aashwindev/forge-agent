import * as vscode from 'vscode';
import { TrueForge } from '@truefoundry/trueforge-sdk';

// Milestone 0: prove the extension is a client of a TrueForge agent.
// Create session -> stream a turn -> render model.message.delta events.
export function activate(ctx: vscode.ExtensionContext) {
  const out = vscode.window.createOutputChannel('Forge Agent');

  ctx.subscriptions.push(
    out,
    vscode.commands.registerCommand('forge.ask', async () => {
      const prompt = await vscode.window.showInputBox({ prompt: 'Ask the Forge agent' });
      if (!prompt) return;

      const cfg = vscode.workspace.getConfiguration('forge');
      const client = new TrueForge({ baseUrl: cfg.get<string>('baseUrl')!, timeoutInSeconds: 600 });

      out.show(true);
      out.appendLine(`> ${prompt}\n`);
      try {
        const { data: session } = await client.sessions.create({
          agent: { spec: { model: { name: cfg.get<string>('model')! }, instructions: 'You are a concise coding assistant.' } },
        });
        const stream = await client.sessions.createTurnStream(session.id, {
          input: [{ type: 'user.message', content: prompt }],
        });
        for await (const { data: event } of stream.withMetadata()) {
          if (event.type === 'model.message.delta') out.append(event.content ?? '');
          if (event.type === 'turn.done') out.appendLine(`\n\n[turn ${event.state.status}]`);
        }
      } catch (e) {
        out.appendLine(`\n[error] ${e instanceof Error ? e.message : String(e)}`);
      }
    }),
  );
}

export function deactivate() {}

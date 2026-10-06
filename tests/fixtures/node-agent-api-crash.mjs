import { startNodeAgentApi } from '../../tools/node-agent-api/server.mjs';

const adapter = {
  writesEnabled: true,
  async requireAgent(id) { return { id }; },
  async input() {
    console.log(JSON.stringify({ backend_called: true }));
    await new Promise(() => {});
  },
};
const service = await startNodeAgentApi({ adapter, stateDirectory: process.argv[2] });
console.log(JSON.stringify({ origin: service.origin, keyFile: service.keyFile }));

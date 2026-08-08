import {
  Account,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";
import type { FlowRouteConfig } from "./config.js";
import { requireContractId } from "./config.js";

export function createRpcServer(config: FlowRouteConfig): rpc.Server {
  return new rpc.Server(config.rpcUrl, {
    allowHttp: config.rpcUrl.startsWith("http://"),
  });
}

// Simulation does not validate the source account against ledger state, so a fresh keypair with sequence "0" is enough for a read-only call.
function simulationAccount(): Account {
  return new Account(Keypair.random().publicKey(), "0");
}

export async function getPayoutCount(
  config: FlowRouteConfig,
  server: rpc.Server = createRpcServer(config),
): Promise<bigint> {
  const contract = new Contract(requireContractId(config));
  const tx = new TransactionBuilder(simulationAccount(), {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(contract.call("get_payout_count"))
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`get_payout_count simulation failed: ${simulation.error}`);
  }
  if (!simulation.result) {
    throw new Error("get_payout_count simulation returned no result");
  }

  const count = scValToNative(simulation.result.retval);
  if (typeof count !== "bigint") {
    throw new Error(`get_payout_count returned an unexpected type: ${typeof count}`);
  }
  return count;
}

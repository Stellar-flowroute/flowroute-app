import {
  Account,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";
import type { FlowRouteConfig } from "./config.js";
import { requireContractId } from "./config.js";
import type { PayoutResult, Recipient, StellarAddress } from "./types.js";
import { i128ToScVal, recipientsToScVal, scValToPayoutResults } from "./xdr.js";

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

// Wallet-agnostic signing hook, takes the unsigned transaction XDR and returns the signed transaction XDR.
export type SignTransaction = (
  transactionXdr: string,
  opts: { networkPassphrase: string },
) => Promise<string>;

export interface ExecuteBatchParams {
  sender: StellarAddress;
  sourceAsset: StellarAddress;
  recipients: Recipient[];
  totalSourceAmount: bigint;
  signTransaction: SignTransaction;
}

export async function executeBatch(
  config: FlowRouteConfig,
  params: ExecuteBatchParams,
  server: rpc.Server = createRpcServer(config),
): Promise<PayoutResult[]> {
  const contract = new Contract(requireContractId(config));
  const account = await server.getAccount(params.sender);

  const operation = contract.call(
    "execute_batch",
    nativeToScVal(params.sender, { type: "address" }),
    nativeToScVal(params.sourceAsset, { type: "address" }),
    recipientsToScVal(params.recipients),
    i128ToScVal(params.totalSourceAmount),
  );

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`execute_batch simulation failed: ${simulation.error}`);
  }

  const prepared = await server.prepareTransaction(tx);
  const signedXdr = await params.signTransaction(prepared.toXDR(), {
    networkPassphrase: config.networkPassphrase,
  });
  const signedTx = TransactionBuilder.fromXDR(signedXdr, config.networkPassphrase);

  const sendResult = await server.sendTransaction(signedTx);
  if (sendResult.status === "ERROR" || sendResult.status === "TRY_AGAIN_LATER") {
    throw new Error(`execute_batch submission failed with status ${sendResult.status}`);
  }

  const result = await server.pollTransaction(sendResult.hash, { attempts: 30 });
  if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`execute_batch transaction ${sendResult.hash} did not succeed, status: ${result.status}`);
  }
  if (!result.returnValue) {
    throw new Error(`execute_batch transaction ${sendResult.hash} succeeded but returned no value`);
  }

  return scValToPayoutResults(result.returnValue);
}

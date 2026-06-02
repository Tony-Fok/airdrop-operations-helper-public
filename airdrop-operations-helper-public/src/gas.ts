import { Decimal } from "decimal.js";

interface JsonRpcResponse<T> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

interface TransactionReceipt {
  gasUsed?: string;
  effectiveGasPrice?: string;
}

interface TransactionByHash {
  gasPrice?: string;
}

export async function getNativeBalance(
  rpcUrl: string,
  walletAddress: string,
  decimals: number
): Promise<string> {
  const balanceHex = await rpc<string>(rpcUrl, "eth_getBalance", [walletAddress, "latest"]);
  return fromBaseUnit(balanceHex, decimals);
}

export async function getGasCostFromReceipt(
  rpcUrl: string,
  txHash: string,
  decimals: number
): Promise<string> {
  const receipt = await rpc<TransactionReceipt | null>(rpcUrl, "eth_getTransactionReceipt", [txHash]);
  if (!receipt) {
    throw new Error(`No receipt found for tx ${txHash}`);
  }

  const gasUsedHex = receipt.gasUsed;
  if (!gasUsedHex) {
    throw new Error(`Receipt missing gasUsed for tx ${txHash}`);
  }

  let gasPriceHex = receipt.effectiveGasPrice;
  if (!gasPriceHex) {
    const tx = await rpc<TransactionByHash | null>(rpcUrl, "eth_getTransactionByHash", [txHash]);
    gasPriceHex = tx?.gasPrice;
  }

  if (!gasPriceHex) {
    throw new Error(`Missing effectiveGasPrice and gasPrice for tx ${txHash}`);
  }

  const gasUsed = hexToDecimal(gasUsedHex);
  const gasPrice = hexToDecimal(gasPriceHex);
  return gasUsed.mul(gasPrice).div(new Decimal(10).pow(decimals)).toFixed();
}

export async function sumGasCostFromReceipts(
  rpcUrl: string,
  txHashes: string[],
  decimals: number
): Promise<string> {
  let total = new Decimal(0);

  for (const txHash of txHashes) {
    const gasCost = await getGasCostFromReceipt(rpcUrl, txHash, decimals);
    total = total.plus(gasCost);
  }

  return total.toFixed();
}

async function rpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params
    })
  });

  if (!response.ok) {
    throw new Error(`RPC ${method} failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as JsonRpcResponse<T>;
  if (payload.error) {
    throw new Error(`RPC ${method} error ${payload.error.code}: ${payload.error.message}`);
  }

  if (typeof payload.result === "undefined") {
    throw new Error(`RPC ${method} returned no result`);
  }

  return payload.result;
}

function fromBaseUnit(hexValue: string, decimals: number): string {
  return hexToDecimal(hexValue).div(new Decimal(10).pow(decimals)).toFixed();
}

function hexToDecimal(hexValue: string): Decimal {
  const normalized = hexValue.startsWith("0x") ? hexValue.slice(2) : hexValue;
  return new Decimal(BigInt(`0x${normalized || "0"}`).toString());
}

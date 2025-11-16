-- CreateTable
CREATE TABLE "Chains" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "rpcUrl" TEXT NOT NULL,
    "gasLimit" INTEGER NOT NULL,
    "isCandideEnabled" BOOLEAN NOT NULL DEFAULT false,
    "bundlerUrl" TEXT,
    "paymasterUrl" TEXT,
    "sponsorshipPolicyId" TEXT,

    CONSTRAINT "Chains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DAOs" (
    "id" TEXT NOT NULL,
    "alternateId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "platform" TEXT NOT NULL,
    "latestIndex" TEXT,

    CONSTRAINT "DAOs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deployments" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "abi" JSONB NOT NULL,
    "daoId" TEXT NOT NULL,

    CONSTRAINT "Deployments_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "DAOs" ADD CONSTRAINT "DAOs_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployments" ADD CONSTRAINT "Deployments_daoId_fkey" FOREIGN KEY ("daoId") REFERENCES "DAOs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

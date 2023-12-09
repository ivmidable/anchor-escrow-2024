import * as anchor from "@coral-xyz/anchor";
import { Program, BN, ProgramAccount } from "@coral-xyz/anchor";
import { AnchorEscrow, IDL } from "../target/types/anchor_escrow";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import { randomBytes } from "crypto";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";

describe("anchor-escrow", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const provider = anchor.getProvider();

  const connection = provider.connection;

  const program = anchor.workspace.AnchorEscrow as Program<AnchorEscrow>;

  const confirm = async (signature: string): Promise<string> => {
    const block = await connection.getLatestBlockhash();
    await connection.confirmTransaction({
      signature,
      ...block,
    });
    return signature;
  };

  const log = async (signature: string): Promise<string> => {
    console.log(
      `Your transaction signature: https://explorer.solana.com/transaction/${signature}?cluster=custom&customUrl=${connection.rpcEndpoint}`
    );
    return signature;
  };

  const getEscrows = async (mintA: PublicKey, mintB: PublicKey) => {
    
  }

  const seed = new BN(randomBytes(8));

  const [maker, taker, mintA, mintB] = Array.from({ length: 4 }, () =>
    Keypair.generate()
  );

  const [makerAtaA, makerAtaB, takerAtaA, takerAtaB] = [maker, taker]
    .map((a) =>
      [mintA, mintB].map((m) =>
        getAssociatedTokenAddressSync(m.publicKey, a.publicKey)
      )
    )
    .flat();

  const escrow = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), maker.publicKey.toBuffer(), seed.toBuffer("le", 8)],
    program.programId
  )[0];
  const vault = getAssociatedTokenAddressSync(mintA.publicKey, escrow, true);

  // Accounts
  const accounts = {
    maker: maker.publicKey,
    taker: taker.publicKey,
    mintA: mintA.publicKey,
    mintB: mintB.publicKey,
    makerAtaA,
    makerAtaB,
    takerAtaA,
    takerAtaB,
    escrow,
    vault,
    associatedTokenprogram: ASSOCIATED_TOKEN_PROGRAM_ID,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  };

  //the accounts here are the ones that are by default visible to the taker.
  let take_accounts = {
    taker: taker.publicKey,
    mintA: mintA.publicKey,
    mintB: mintB.publicKey,
    takerAtaA,
    takerAtaB,
    associatedTokenprogram: ASSOCIATED_TOKEN_PROGRAM_ID,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  };

  it("Airdrop and create mints", async () => {
    let lamports = await getMinimumBalanceForRentExemptMint(connection);
    let tx = new Transaction();
    tx.instructions = [
      ...[maker, taker].map((k) =>
        SystemProgram.transfer({
          fromPubkey: provider.publicKey,
          toPubkey: k.publicKey,
          lamports: 10 * LAMPORTS_PER_SOL,
        })
      ),
      ...[mintA, mintB].map((m) =>
        SystemProgram.createAccount({
          fromPubkey: provider.publicKey,
          newAccountPubkey: m.publicKey,
          lamports,
          space: MINT_SIZE,
          programId: TOKEN_PROGRAM_ID,
        })
      ),
      ...[
        [mintA.publicKey, maker.publicKey, makerAtaA],
        [mintB.publicKey, taker.publicKey, takerAtaB],
      ].flatMap((x) => [
        createInitializeMint2Instruction(x[0], 6, x[1], null),
        createAssociatedTokenAccountIdempotentInstruction(
          provider.publicKey,
          x[2],
          x[1],
          x[0]
        ),
        createMintToInstruction(x[0], x[2], x[1], 1e9),
      ]),
    ];

    await provider.sendAndConfirm(tx, [mintA, mintB, maker, taker]).then(log);
  });

  it("Make", async () => {
    await Escrow.make({ ...accounts });
  });

  xit("Refund", async () => {
    await Escrow.refund({ ...accounts });
  });

  xit("Take", async () => {
    await Escrow.take({ ...accounts });
  });

  const anchor_descrim_size = 8;
  const seed_size = 8;
  const maker_pubkey_size = 32;
  const offset = anchor_descrim_size + seed_size + maker_pubkey_size;

  /// UX Testing.
  it("(SHOULD FAIL)Taker Finds Escrow for chosen mints and executes a trade", async () => {
    let escrows = await Escrow.fetch(mintA.publicKey, mintB.publicKey);

    //now that i've found escrows with my chosen mints, now I need to execute a trade.

    //create vault ata from escrow
    //we need to do this because we wouldn't know the escrow account address before fetching.

    take_accounts["escrow"] = escrows[0].publicKey;
    take_accounts["vault"] = getAssociatedTokenAddressSync(
      escrows[0].account.mintA,
      escrows[0].publicKey,
      true
    );

    //where do we find this info?
    take_accounts["maker"] = PublicKey.default;
    take_accounts["makerAtaB"] = PublicKey.default;

    try {
      await Escrow.take({... take_accounts});
    } catch (e) {
      console.log(
        "This test failed because maker and both maker_atas are unable to be found."
      );
    }
  });

  it("Execute a take via a real takers perscpective.", async () => {
    let escrows = await Escrow.fetch(mintA.publicKey, mintB.publicKey);

    //now that i've found escrows with my chosen mints, now I need to execute a trade.

    //create vault ata from escrow
    //we need to do this because we wouldn't know the escrow account address before fetching.
    take_accounts["escrow"] = escrows[0].publicKey;
    take_accounts["vault"] = getAssociatedTokenAddressSync(
      escrows[0].account.mintA,
      escrows[0].publicKey,
      true
    );
    take_accounts["maker"] = escrows[0].publicKey;
    take_accounts["makerAtaB"] = getAssociatedTokenAddressSync(
      escrows[0].account.mintB,
      escrows[0].account.maker,
      true
    );

    try {
      await Escrow.take({... take_accounts});
    } catch (e) {
      console.log(
        "This test failed because maker and both maker_atas are unable to be found."
      );
    }
  });

  it("Find a escrow that is a good deal.", async () => {
    //make multiple escrows with diffrent amounts and mints

    //fetch all escrows with the right mints

    //filter out escrows with a "bad" deal for taker.

  });



  const Escrow = {
    make: async (accounts:any) => {
      await program.methods
      .make(seed, new BN(1e6), new BN(1e6))
      .accounts({ ...accounts })
      .signers([maker])
      .rpc()
      .then(confirm)
      .then(log);
    },
    refund: async (accounts:any) => {
      await program.methods
      .refund()
      .accounts({ ...accounts })
      .signers([maker])
      .rpc()
      .then(confirm)
      .then(log);
    },
    take: async (accounts:any) => {
      await program.methods
      .take()
      .accounts({ ...accounts })
      .signers([taker])
      .rpc()
      .then(confirm)
      .then(log);
    },
    fetch: async (mintA:PublicKey, mintB:PublicKey) => {
      let encoded = bs58.encode(
        Buffer.concat([mintA.toBuffer(), mintB.toBuffer()])
      );
  
      let escrows = await program.account.escrow.all([
        {
          memcmp: {
            offset: offset, //we need to offset the anchor descriminator.
            bytes: encoded,
          },
        },
      ]);
  
      return escrows;
    }
  }
});

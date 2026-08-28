import Link from "next/link";

export default function NotFound() {
  return (
    <section className="panel">
      <div className="panel-title">No such record</div>
      <h1 className="title">Nothing is rezzed at this address.</h1>
      <p className="lede mt-3 max-w-2xl">
        A receipt id that does not resolve is worth knowing about: ids in this system are minted
        deterministically during bootstrap, so a link from an older instance can point at a receipt this one
        never wrote. The ledger below is the authority on what exists.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link href="/receipts" className="key key-lume">
          Open the ledger
        </Link>
        <Link href="/overview" className="key">
          Overview
        </Link>
      </div>
    </section>
  );
}

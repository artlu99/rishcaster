import './App.css'

function App() {
  return (
    <>
      <section id="center">
        <h1>rishcaster</h1>
        <p className="lede">
          A tiny micro-site for Farcaster links. Every path like{' '}
          <code>/zoo/0x79794547</code> renders the cast inline — shareable and
          fast, no app required.
        </p>
        <p>
          Open an example: <a href="/zoo/0x79794547">/zoo/0x79794547</a> (signed) or{" "}
          <a href="/decent-artlu/0x30102c7a">/decent-artlu/0x30102c7a</a> (unsigned)
        </p>
        <p className="lede">
          Every cast renders with full data from the chain, linking to
          farcaster.xyz and Firefly. Authors who haven't signed Farcaster's
          social smart contract are read-only on farcaster.xyz, so their pages
          link to Firefly only.
        </p>
        <p className="repo-link">
          <a href="https://github.com/artlu99/rishcaster">source</a>
        </p>
      </section>
      <div className="ticks"></div>
    </>
  )
}

export default App

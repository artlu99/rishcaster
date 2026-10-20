import './App.css'

function App() {
  return (
    <>
      <section id="center">
        <h1>rishcaster</h1>
        <p className="lede">
          A tiny micro-site for Farcaster links. Every path like{' '}
          <code>/zoo/0x79794547</code> renders a simple page that points back
          to the same spot on farcaster.xyz — shareable and fast, no app
          required.
        </p>
        <p>
          Open an example: <a href="/zoo/0x79794547">/zoo/0x79794547</a> (signed) or{" "}
          <a href="/decent-artlu/0x30102c7a">/decent-artlu/0x30102c7a</a> (banned)
        </p>
        <p className="lede">
          Accounts come in two kinds: signed ones hold a soulbound NFT from an
          onchain contract and render with full cast data; banned ones get no
          Farcaster API data, so their pages show a notice and a direct link.
        </p>
      </section>
      <div className="ticks"></div>
    </>
  )
}

export default App

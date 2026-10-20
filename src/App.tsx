import './App.css'

function App() {
  return (
    <>
      <section id="center">
        <p className="eyebrow">Farcaster, unfurled</p>
        <h1>rishcaster</h1>
        <p className="lede">
          Every Farcaster cast, one clean link away — rendered straight from
          the chain. No app, no login.
        </p>
        <div className="examples">
          <a className="example" href="/zoo/0x79794547">
            <span className="path">/zoo/0x79794547</span>
            <span className="caption">signed author</span>
          </a>
          <a className="example" href="/decent-artlu/0x30102c7a">
            <span className="path">/decent-artlu/0x30102c7a</span>
            <span className="caption">unsigned author</span>
          </a>
        </div>
        <p className="lede footnote">
          Pages link to farcaster.xyz and Firefly. Authors who haven't signed
          Farcaster's social smart contract are read-only there, so their
          pages link to Firefly only.
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

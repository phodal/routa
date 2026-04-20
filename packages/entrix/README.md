# Entrix (NPM)

Command-line distribution of Entrix through npm. The package provides
the `entrix` command by resolving a prebuilt platform binary and
launching it through a thin Node.js wrapper.

This is the **Rust implementation** of entrix. For the Python implementation, use `pip install entrix`.

## Installation

Install globally:

```bash
npm install -g entrix
```

Run without installing:

```bash
npx entrix --help
```

The installed command is `entrix`.

## Package Layout

`entrix` is a thin launcher package. At install time npm resolves one
of these optional platform packages and the wrapper executes the bundled binary:

- `entrix-darwin-arm64`
- `entrix-darwin-x64`
- `entrix-linux-x64`
- `entrix-windows-x64`

## Alternative Installation

### Via Cargo (Rust)

```bash
cargo install entrix
```

### Via pip (Python)

```bash
pip install entrix
```

## Usage

```bash
entrix --help
entrix run --tier fast
entrix validate
```

## License

MIT

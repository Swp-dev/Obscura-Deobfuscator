# JS Obscura Deobfuscator

A powerful **deobfuscator** for JavaScript code obfuscated by **Obscura** (KTN Obfuscator).

---

## 🌟 Introduction

**JS Obscura Deobfuscator** is a command-line tool designed to reverse and clean JavaScript code obfuscated by the Obscura obfuscator.

It effectively handles:
- String decryption
- Function table recovery
- State machine linearization (while + switch)
- Junk code and dead variable removal
- Code structure normalization

Built with TypeScript/Node.js and powered by **Babel AST** manipulation.

---

##  Key Features

- Automatic detection of Obscura patterns and signatures
- Dynamic string decryption using VM sandbox
- Advanced state machine linearization
- Function table extraction and restoration
- Removal of junk code, method aliases, and preamble
- Support for both legacy and latest Obscura versions
- Beautiful CLI with gradient banner

---

## Installation
```bash
npm install
```

## Usage
```bash
tsx deobf_obscura.ts
```

---
## Author:
KTN: Trương Nhật Bảo Nam
Instagram: @_kingktn
Discord: @_kingktn
Tiktok: @traitimkhongcondaunuaroi

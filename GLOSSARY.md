# Neo

Neo is a pixel-pet AI companion: a face on an Android phone that listens, answers, and does tasks, with its brain running on the user's Mac.

## Parts

**Neo Console**:
The Mac app the user controls Neo from (console window, memory & jobs window, settings, menu bar). It holds no Neo logic of its own.
_Avoid_: Neo.app, Mac app, console UI

**NeoCli**:
The backend: everything that thinks, remembers, schedules, and serves the phone. It ships as the Neo daemon plus the neo command.
_Avoid_: server, backend, server.js

**Neo daemon**:
The long-running NeoCli process that the phone and Neo Console connect to.
_Avoid_: server, service

**neo command**:
The command-line entry point to NeoCli, used by people and by Neo Console to drive the Neo daemon.
_Avoid_: CLI tool, neo-cli

**NeoApp**:
The Android app that shows Neo's face and carries the microphone, speaker, and sensors.
_Avoid_: mochi, companion app, phone app

## Pet

**Pet name**:
The name the user gives Neo (e.g. "John"); Neo introduces itself by it and the wake word listens for it. "Neo" is the product, not the pet's name.
_Avoid_: wake name, bot name

## Thinking

**Brain**:
The AI that answers for Neo; which one is in use is chosen by **provider** (Claude Code, an ACP agent, an OpenAI-compatible endpoint) and **model**.
_Avoid_: LLM, AI backend

**Fast phrase**:
Something the user says that Neo handles itself without asking the Brain (set an alarm, go to sleep, feed, switch brain).
_Avoid_: command, shortcut, intent

## What Neo keeps

**Memory**:
Neo's long-term notes about the user, one human-editable document used with every answer.
_Avoid_: facts, knowledge base

**Dream**:
One background session, while the user is away, in which Neo reorganises its memory from the journal and researches past requests further; each dream is kept as its own record.
_Avoid_: dreaming run, defrag

**Journal**:
The log of what the user asked and what Neo answered, kept per day; the raw material for the next dream.
_Avoid_: history, chat log

**Job**:
Something scheduled for a time: an **alarm** (Neo rings) or a **task** (Neo does the work at that time).
_Avoid_: cron, reminder, timer

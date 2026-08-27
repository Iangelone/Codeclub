# Synapse and Devices
Synapse is the vision for connecting a feature to its code, tasks, validations, and release. It is not another Kanban board: it should show what is being built and what evidence supports it.

The Devices section is currently disabled. The future idea is to connect an Android phone to the IDE through a QR code:

    Codeclub on PC -> QR -> Android app -> secure channel -> IDE

There is no mobile runtime or active connection yet. The entry remains visible so the direction is discoverable, but it is not presented as a usable feature.

## Feature model

| Pipeline | Flow |
| --- | --- |
| Visual | Wireframe -> UI -> Responsive -> Approved |
| Frontend | Components -> States -> Integration -> Validated |
| API | Contract -> Endpoint -> Errors -> Connected |
| Data | Model -> Persistence -> Verified |
| QA | Tests -> Review -> Visual validation -> Ready |
| Release | Changelog -> Commit -> Deploy -> Monitoring |

A future MVP should create a feature, generate pipelines, link files and tasks, read basic Git status, show progress and blockers, and open related files or panels.

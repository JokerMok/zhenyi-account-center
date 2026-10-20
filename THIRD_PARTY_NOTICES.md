# Third-party components

Casdoor v4.22.0 is Copyright The Casdoor Authors, licensed under Apache License 2.0.
`infra/casdoor-init.template.json` contains a configuration subset of the tagged upstream `init_data.json.template`, adapted by the local initialization script at runtime. The upstream license is included in `infra/CASDOOR-LICENSE`.

Source: https://github.com/casdoor/casdoor/tree/v4.22.0

The Casdoor executable and frontend are downloaded from the official fixed release and stored outside Git in `.local/`. Other JavaScript dependencies and their exact versions are recorded in `package-lock.json`; their licenses remain in the installed package directories.

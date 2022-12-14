/**
 * File: tscoder.ts
 * Purpose: ???????????????????????????
 */

import { Project, StructureKind } from "ts-morph";

export const test = () => { return "tscoder.test() executed" }

export abstract class tscoderx {
    public static test0() {
        return "test0";
    }
        public static test1() {
        const project = new Project({
            tsConfigFilePath: "testsrc/tsconfig.json",
        });
        
        project.addSourceFilesAtPaths("testsrc/**/*{.d.ts,.ts}");
        
        const sourceFile = project.createSourceFile("testsrc/myStructureFile.ts",
            {
                statements: [{
                    kind: StructureKind.Enum,
                    name: "MyEnum",
                    members: [{
                        name: "member",
                    }],
                }, {
                    kind: StructureKind.Class,
                    name: "MyClass"
                }],
            },
            {
                overwrite: true
            }
        );
        
        sourceFile.saveSync();
        
    }
}
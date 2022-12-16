/* transform.ts
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 * SPDX-FileCopyrightText: 2022 Roman Tyukh
 *
 */

'use strict';

import { API, FileInfo } from 'jscodeshift';
// import { ExpressionKind } from 'ast-types/gen/kinds';

"use strict";

export const parser = "ts";

function exportFunctions(source: string, api: API): string {
  const j = api.jscodeshift;
  const root = j(source);

  root.find(j.FunctionDeclaration).forEach((path) => {
    if (path.parent.value.type === "Program") j(path).replaceWith(j.exportNamedDeclaration(path.node));
  });

  return root.toSource();
}

function exportVariables(source: string, api: API): string {
  const j = api.jscodeshift;
  const root = j(source);

  root.find(j.VariableDeclaration).forEach((path) => {
    if (path.parent.value.type === "Program") {
      if (path.node.kind === "var") j(path).replaceWith(j.exportNamedDeclaration(path.node));
    }
  });

  return root.toSource();
}

function importVariables(source: string, api: API): string {
  const j = api.jscodeshift;
  const root = j(source);

  root.find(j.VariableDeclaration).forEach((path) => {
    if (path.parent.value.type === "Program") {
      if (path.node.declarations !== undefined) {
        let declarations = path.node.declarations.filter((declarator) => {
          if (declarator.init) {
            if (declarator.init.type === "Identifier" || declarator.init.type === "MemberExpression") {
              let expression = [];
              let object = declarator.init;
              while (object.type !== "Identifier") {
                expression.push(object.property.name);
                object = object.object;
              }
              if (object.name === "imports") {
                let url = expression.reverse().join("/");
                switch (declarator.id.type) {
                  case "ObjectPattern":
                    break;
                  case "Identifier":
                    let name = declarator.id.name;
                    if(path.node.kind === "var") {
                      name = `_imports_${expression.join("_")}`;
                      path.insertAfter(j.variableDeclaration("var", [j.variableDeclarator(declarator.id, j.identifier(name))]));  
                    }
                    path.insertBefore(j.importDeclaration([j.importNamespaceSpecifier(j.identifier(name))], j.literal(url)));
                    return false;
                }
              }
            }
          }
          return true;
        });
        if(declarations.length)
          path.node.declarations = declarations;
        else
          path.prune();
      }
    } else {
    }
  });
  return root.toSource();
}

export default function transformer(file: FileInfo, api: API): string {
  let source: string = file.source;

  source = importVariables(source, api);
  source = exportFunctions(source, api);
  source = exportVariables(source, api);

  return source;
}

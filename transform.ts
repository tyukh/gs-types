/* transform.ts
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 * SPDX-FileCopyrightText: 2022 Roman Tyukh
 *
 */

'use strict';

import {API, FileInfo, ImportDeclaration} from 'jscodeshift';
import * as Modules from './transform.modules';

export const parser = 'ts';

function exportFunctions(source: string, api: API): string {
  const j = api.jscodeshift;
  const root = j(source);

  root.find(j.FunctionDeclaration).forEach((path) => {
    if (path.parent.value.type === 'Program') j(path).replaceWith(j.exportNamedDeclaration(path.node));
  });

  return root.toSource();
}

function exportVariables(source: string, api: API): string {
  const j = api.jscodeshift;
  const root = j(source);

  root.find(j.VariableDeclaration).forEach((path) => {
    if (path.parent.value.type === 'Program') {
      if (path.node.kind === 'var') j(path).replaceWith(j.exportNamedDeclaration(path.node));
    }
  });

  return root.toSource();
}

function importVariables(source: string, api: API): string {
  const j = api.jscodeshift;
  const root = j(source);

  function insertTopImport(ast: ImportDeclaration) {
    let path = root.find(j.ImportDeclaration);
    if (path.length) path.at(path.length - 1).insertAfter(ast);
    else root.get().node.program.body.unshift(ast);
  }

  function isImported(name: string): boolean {
    for (const path of root.find(j.ModuleSpecifier).paths()) if (path.node.local?.name === name) return true;
    return false;
  }

  root.find(j.Identifier).forEach((path) => {
    if (path.node.name !== 'imports') return;

    let imports: string[] = [];
    let parent = path.parent;
    while (parent.node.type === 'MemberExpression') {
      imports.push(parent.node.property.name);
      parent = parent.parent;
    }

    function getImportsName(object: string | undefined = undefined): string {
      if (object !== undefined) return `_imports_${imports.join('_')}_${object}_`;
      return `_imports_${imports.join('_')}_`;
    }

    function createImport(variable: string, object: string | undefined = undefined): boolean {
      if (isImported(variable)) return true;

      function isUndefinedError(value: any, message: string, node: any) {
        if (value === undefined) {
          if (node.comments === undefined) node.comments = [];
          node.comments.push(j.commentLine(message));
          api.report(message);
          return true;
        }
        return false;
      }

      if (isUndefinedError(imports.at(0), ` -!!!- ${variable}: Domain is absent`, parent.node)) return false;
      let modules: string[][] = Modules.domainsModulesMap.get(imports.at(0)!)!;
      if (isUndefinedError(modules, ` -!!!- ${variable}: Unknown domain "${imports.at(0)}"`, parent.node)) return false;

      function checkObject() {
        if (object !== undefined) {
          let importsInclusive = [...imports];
          importsInclusive.push(object);
          return Modules.getModuleURLs(importsInclusive, modules);
        }
        return Modules.getModuleURLs(imports, modules);
      }

      let url: {module: string; object: string} = checkObject()!;
      if (isUndefinedError(url, ` -!!!- ${variable}: Unknown module "${imports.join('/')}"`, parent.node)) return false;

      if (imports.at(0) === 'gi' || imports.at(0) === 'cairo') url.module = Modules.giMap.get(url.module)!;

      if (url.object !== '')
        insertTopImport(
          j.importDeclaration([j.importSpecifier(j.identifier(url.object), j.identifier(variable))], j.literal(url.module))
        );
      else insertTopImport(j.importDeclaration([j.importNamespaceSpecifier(j.identifier(variable))], j.literal(url.module)));

      return true;
    }

    switch (parent.node.type) {
      case 'VariableDeclarator':
        switch (parent.node.id.type) {
          case 'Identifier':
            {
              let variableDeclaration = parent.parent;
              let variableDeclarator = parent;
              let name = variableDeclarator.node.id.name;
              if (variableDeclaration.node.kind === 'var' || variableDeclaration.parent.value.type !== 'Program') {
                name = getImportsName();
                if (createImport(name))
                  variableDeclarator.replace(
                    j.variableDeclarator(j.identifier(variableDeclarator.node.id.name), j.identifier(name))
                  );
              } else if (createImport(name)) variableDeclarator.replace();
              if (variableDeclaration.node.declarations.length === 0) variableDeclaration.prune();
            }
            break;

          case 'ObjectPattern':
            {
              let variableDeclaration = parent.parent;
              let variableDeclarator = parent;
              let properties = variableDeclarator.node.id.properties.filter((property: any) => {
                let name = property.key.name;
                if (variableDeclaration.node.kind === 'var' || variableDeclaration.parent.value.type !== 'Program') {
                  name = getImportsName(name);
                  if (createImport(name, property.key.name)) {
                    variableDeclaration.insertAfter(
                      j.variableDeclaration(variableDeclaration.node.kind, [
                        j.variableDeclarator(j.identifier(property.key.name), j.identifier(name)),
                      ])
                    );
                    return false;
                  }
                  return true;
                }
                return !createImport(name, property.key.name);
              });
              if (properties.length) variableDeclarator.node.id.properties = properties;
              else variableDeclarator.replace();
              if (variableDeclaration.node.declarations.length === 0) variableDeclaration.prune();
            }
            break;
        }
        break;

      case 'ObjectProperty':
        {
          let name = getImportsName();
          if (createImport(name)) parent.node.value = j.identifier(name);
        }
        break;

      case 'CallExpression':
        {
          let name = getImportsName();
          if (createImport(name)) parent.node.arguments = [j.identifier(name)];
        }
        break;
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

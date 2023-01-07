/* transform.ts
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 * SPDX-FileCopyrightText: 2022 Roman Tyukh
 *
 */

'use strict';

import {ExpressionKind} from 'ast-types/gen/kinds';
import {
  API,
  ExportNamedDeclaration,
  FileInfo,
  FunctionDeclaration,
  Identifier,
  ImportDeclaration,
  ObjectProperty,
  VariableDeclaration,
} from 'jscodeshift';
import * as Modules from './transform.modules';

export const parser = 'ts';

function transformNamespaces(source: string, api: API): string {
  const j = api.jscodeshift;
  const root = j(source);

  function isVariableDefined(name: string): boolean {
    for (const path of root.find(j.VariableDeclarator).paths())
      if (path.parent.parent.value.type === 'Program') if ((path.node.id as Identifier).name === name) return true;
    return false;
  }

  function createExpression(properties: string[]): ExpressionKind {
    let object: ExpressionKind = j.identifier('imports');
    for (const property of properties) object = j.memberExpression(object, j.identifier(property));
    return object;
  }

  root.find(j.Identifier).forEach((path) => {
    if (path.node.name !== 'imports') return;

    let imports: string[] = [];
    let parent = path.parent;
    let child = undefined;
    while (parent.node.type === 'MemberExpression') {
      child = parent;
      imports.push(parent.node.property.name);
      parent = parent.parent;
    }

    let computed: string | undefined = undefined;
    if (child.node.computed === true) computed = imports.pop();

    if (parent.node.type === 'VariableDeclarator') if (parent.node.id.type === 'ObjectPattern') return;

    if (imports.at(0) === undefined) return;
    let modules: {modules: string[][]; map: Map<string, string>} = Modules.domainsModulesMap.get(imports.at(0)!)!;
    if (modules === undefined) modules = Modules.domainsModulesMap.get('')!;

    let properties: ObjectProperty[] = [];
    for (const module of modules.modules)
      if (module.length > imports.length)
        if (imports.every((element, index) => element === module[index]))
          properties.push(j.objectProperty(j.identifier(module.slice(imports.length).join('')), createExpression(module)));

    if (properties.length !== 0) {
      let name = `_imports_${imports.join('_')}_`;
      if (!isVariableDefined(name))
        root
          .get()
          .node.program.body.unshift(
            j.variableDeclaration('let', [j.variableDeclarator(j.identifier(name), j.objectExpression(properties))])
          );

      if (computed === undefined) child.replace(j.identifier(name));
      else child.replace(j.memberExpression(j.identifier(name), j.identifier(computed), true));
    }
  });

  return root.toSource();
}

function transformImportVariables(source: string, api: API): string {
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
    let child = undefined;
    while (parent.node.type === 'MemberExpression') {
      child = parent;
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
      let modules: {modules: string[][]; map: Map<string, string>} = Modules.domainsModulesMap.get(imports.at(0)!)!;
      // if (isUndefinedError(modules, ` -!!!- ${variable}: Unknown domain "${imports.at(0)}"`, parent.node)) return false;
      if (modules === undefined) modules = Modules.domainsModulesMap.get('')!;

      function getModuleURLs(item: string[], modules: string[][]): {module: string; object: string} | undefined {
        for (const module of modules)
          if (module.length <= item.length)
            if (module.every((element: string, index: number) => element === item[index]))
              return {
                module: module.join('/'),
                object: item.slice(module.length).join('/'),
              };
        return undefined;
      }

      function checkObject() {
        if (object !== undefined) {
          let importsInclusive = [...imports];
          importsInclusive.push(object);
          return getModuleURLs(importsInclusive, modules.modules);
        }
        return getModuleURLs(imports, modules.modules);
      }

      let url: {module: string; object: string} = checkObject()!;
      if (isUndefinedError(url, ` -!!!- ${variable}: Unknown module "${imports.join('/')}"`, parent.node)) return false;

      url.module = modules.map.get(url.module)!;

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
                let name = property.value.name;
                if (variableDeclaration.node.kind === 'var' || variableDeclaration.parent.value.type !== 'Program') {
                  name = getImportsName(property.key.name);
                  if (createImport(name, property.key.name)) {
                    variableDeclarator.replace(j.variableDeclarator(j.identifier(property.value.name), j.identifier(name)));
                    return true;
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

      case 'AssignmentExpression':
        {
          let name = getImportsName();
          if (createImport(name)) child.replace(j.identifier(name));
        }
        break;

      case 'ObjectProperty':
        {
          let name = getImportsName();
          if (createImport(name)) parent.node.value = j.identifier(name);
        }
        break;

      case 'CallExpression':
      case 'NewExpression':
        {
          let name = getImportsName();
          if (createImport(name)) child.replace(j.identifier(name));
        }
        break;
    }
  });
  return root.toSource();
}

function moveComments(destination: ExportNamedDeclaration, source: FunctionDeclaration | VariableDeclaration) {
  destination.comments = source.comments;
  source.comments = undefined;
  return destination;
}

function transformExportFunctions(source: string, api: API): string {
  const j = api.jscodeshift;
  const root = j(source);

  root.find(j.FunctionDeclaration).forEach((path) => {
    if (path.parent.value.type === 'Program') path.replace(moveComments(j.exportNamedDeclaration(path.node), path.node));
  });

  return root.toSource();
}

function transformExportVariables(source: string, api: API): string {
  const j = api.jscodeshift;
  const root = j(source);

  root.find(j.VariableDeclaration).forEach((path) => {
    if (path.parent.value.type === 'Program')
      if (path.node.kind === 'var') path.replace(moveComments(j.exportNamedDeclaration(path.node), path.node));
  });

  return root.toSource();
}

export default function transformer(file: FileInfo, api: API): string {
  let source: string = file.source;

  source = transformNamespaces(source, api);
  source = transformImportVariables(source, api);
  source = transformExportFunctions(source, api);
  source = transformExportVariables(source, api);

  return source;
}

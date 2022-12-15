/* eslint-disable */
// jscodeshift can take a parser, like "babel", "babylon", "flow", "ts", or "tsx"
// Read more: https://github.com/facebook/jscodeshift#parser
export const parser = "babel";

function transformExtensionImport(path, api) {
  const j = api.jscodeshift;
  if (path.node.declarations.length < 1) return;
  const [declaration] = path.node.declarations;
  if (!declaration.init) return;
  if (
    !declaration.init.object ||
    !declaration.init.object.object ||
    declaration.init.object.object.name !== "Me"
  )
    return;

  if (!declaration.init.object.property) return;
  if (declaration.init.object.property.name !== "imports") return;

  let specifier = j.importNamespaceSpecifier(j.identifier(declaration.id.name));
  let importDeclaration = j.importDeclaration(
    [specifier],
    j.literal(`./${declaration.init.property.name}.js`)
  );

  j(path).replaceWith(importDeclaration);
}

function transformImport(path, api) {
  const j = api.jscodeshift;

  if (path.node.declarations.length < 1) return false;

  const [declaration] = path.node.declarations;

  if (!declaration.init || !declaration.init.object || !declaration.init.object.object) return false;

  if (declaration.init.object.object.name !== "imports") return false;

  if (!declaration.init.object.property) return false;

  const folderName = declaration.init.object.property.name;

  if (folderName === "gi") {
    let specifier = j.importDefaultSpecifier(j.identifier(declaration.id.name));
    let importUri = `gi://${declaration.init.property.name}`;
    let importDeclaration = j.importDeclaration([specifier], j.literal(importUri));

    j(path).replaceWith(importDeclaration);

    return true;
  }

  let importUri = `resource:///org/gnome/shell/${folderName}/${declaration.init.property.name}.js`;
  let specifier = j.importNamespaceSpecifier(j.identifier(declaration.id.name));
  let importDeclaration = j.importDeclaration([specifier], j.literal(importUri));

  j(path).replaceWith(importDeclaration);

  return true;
}

function updateImports(source, api) {
  const j = api.jscodeshift;

  return j(source)
    .find(j.VariableDeclaration)
    .forEach((path) => {
      if (!transformImport(path, api)) transformExtensionImport(path, api);
    });
}

let classBindingRenames = new Map();

function updateExports(source, api) {
  const j = api.jscodeshift;

  return j(source)
    .find(j.VariableDeclaration)
    .forEach((path) => {
      if (path.node.kind !== "var") return;

      if (path.node.declarations.length === 0) return;
      const declaration = path.node.declarations[0];
      if (declaration.init.type === "ClassExpression") {
        if (!declaration.init.id || declaration.id.name === declaration.init.id.name) {
          j(path).replaceWith(
            j.exportNamedDeclaration(
              j.classDeclaration(
                j.identifier(declaration.id.name),
                declaration.init.body,
                declaration.init.superClass
              )
            )
          );
        } else {
          let spec = j.exportSpecifier.from({
            local: j.identifier(declaration.init.id.name),
            exported: j.identifier(declaration.id.name),
          });
          classBindingRenames.set(declaration.id.name, declaration.init.id.name);
          let exportDeclaration = j.exportNamedDeclaration(null, [spec], null); //

          j(path)
            .replaceWith(
              j.classDeclaration(
                j.identifier(declaration.init.id.name),
                declaration.init.body,
                declaration.init.superClass
              )
            )
            .insertAfter(exportDeclaration);
        }

        return;
      }
      let exportDeclaration = j.exportNamedDeclaration(
        j.variableDeclaration("const", [
          j.variableDeclarator(
            j.identifier(path.node.declarations[0].id.name),
            path.node.declarations[0].init
          ),
        ])
      );

      j(path).replaceWith(exportDeclaration);
    });
}

/**
 * @param source
 * @param api
 */
export function updateFunctionExports(source, api) {
  const j = api.jscodeshift;

  return j(source)
    .find(j.FunctionDeclaration)
    .forEach((path) => {
      let exportDeclaration = j.exportNamedDeclaration(path.node);

      j(path).replaceWith(exportDeclaration);
    });
}

function updateInlineImports(source, api) {
  const j = api.jscodeshift;
  const root = j(source);

  let localBindings = {};
  const inlineImports = new Set(
    root
      .find(j.MemberExpression)
      .paths()
      .filter((path) => {
        if (path.node.object && path.node.object.name === "Me") {
          if (path.node.property.name === "imports") {
            return true;

            console.log(5, path.parentPath.parentPath.node.property.name); // value
          }
        }
      })
      .map((path) => {
        const file = path.parentPath.node.property.name;

        return file;
      })
  );

  root
    .find(j.ImportDeclaration)
    .at(-1)
    .insertBefore(
      [...inlineImports].map((ii) => {
        const localBinding = ii[0].toUpperCase() + ii.slice(1);
        localBindings[ii] = localBinding;
        return `import * as ${localBinding} from './${ii}.js'`;
      })
    );

  root.find(j.MemberExpression).forEach((path) => {
    if (path.node.object && path.node.object.name === "Me") {
      if (path.node.property.name === "imports") {
        const file = path.parentPath.node.property.name;
        const expr = j.memberExpression(
          j.identifier(localBindings[file]),
          path.parentPath.parentPath.node.property,
          false
        );

        path.parentPath.parentPath.replace(expr);
        const p = path.parentPath.parentPath.parentPath;
        const comments = (p.node.comments = p.node.comments || []);

        comments.push(
          j.commentLine(`TODO(codemod): This was originally an inline import of Me.imports.${file}`)
        );
      }
    }
  });

  return root;
}

function renameClassBindings(source, api) {
  const j = api.jscodeshift;
  const root = j(source);

  root.find(j.Identifier).forEach((path) => {
    if (classBindingRenames.has(path.node.name) && path.parentPath.value.type !== "ExportSpecifier")
      j(path).replaceWith(j.identifier(classBindingRenames.get(path.node.name)));
  });

  return root;
}

const transforms = [
  updateImports,
  updateInlineImports,
  updateExports,
  renameClassBindings,
  updateFunctionExports,
];

/**
 * @param file
 * @param api
 */
export default function transformer(file, api) {
  const j = api.jscodeshift;

  let source = file.source;
  for (const mod of transforms) source = mod(source, api).toSource();

  return source;
}

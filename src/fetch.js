import axios from 'axios';
import { isObject, forEach, set, castArray, startsWith } from 'lodash';

export const fetchData = async (endpoint, ctx) => {
  const { apiURL, queryLimit, jwtToken, reporter } = ctx;

  // Define API endpoint.
  let apiBase = `${apiURL}/${endpoint}`;

  const apiEndpoint = `${apiBase}?_limit=${queryLimit}`;

  reporter.info(`Starting to fetch data from Strapi - ${apiEndpoint}`);

  try {
    const { data } = await axios(apiEndpoint, addAuthorizationHeader({}, jwtToken));
    return castArray(data).map(clean);
  } catch (error) {
    reporter.panic(`Failed to fetch data from Strapi`, error);
  }
};

function buildRichTextPath(item, maps, types, components = {}) {
  const isComponent = !item.kind;

  if (isComponent && components[item.uid]) {
    // already processed component
    return;
  } else if (!isComponent && types[item.uid]) {
    // already processed type
    return;
  } else if (!item.attributes) {
    // not a complex type => has no rich text fields
    return;
  }

  for (const [key, attr] of Object.entries(item.attributes)) {
    if (attr.type === 'richtext') {
      // register path
      if (isComponent) {
        components[item.uid] = components[item.uid] || [];
        components[item.uid].push(key);
      } else {
        types[item.uid] = types[item.uid] || [];
        types[item.uid].push(key);
      }
    } else if (attr.type === 'component') {
      // start recursion
      buildRichTextPath(maps.components[attr.component], maps, types, components);

      // check paths
      if (components[attr.component]) {
        const keys = components[attr.component].map(path => `${key}.${path}`);

        if (isComponent) {
          components[item.uid] = components[item.uid] || [];
          components[item.uid].push(...keys);
        } else {
          types[item.uid] = types[item.uid] || [];
          types[item.uid].push(...keys);
        }
      }
    } else if (attr.target) {
      // start recursion
      buildRichTextPath(maps.types[attr.target], maps, types, components);

      // check paths
      if (types[attr.target]) {
        const keys = types[attr.target].map(path => `${key}.${path}`);

        if (isComponent) {
          components[item.uid] = components[item.uid] || [];
          components[item.uid].push(...keys);
        } else {
          types[item.uid] = types[item.uid] || [];
          types[item.uid].push(...keys);
        }
      }
    }
  }
}

export const fetchMetadata = async (ctx) => {
  const { apiURL, jwtToken, reporter } = ctx;

  // Define API endpoint.
  let apiBase = `${apiURL}/content-type-builder`;

  reporter.info(`Starting to fetch metadata from Strapi - ${apiBase}`);

  try {
    const [types, components] = await Promise.all([
      axios(`${apiBase}/content-types`, addAuthorizationHeader({}, jwtToken)),
      axios(`${apiBase}/components`, addAuthorizationHeader({}, jwtToken)),
    ]);

    const typesMap = types.data.data
      // filter built-in & plugin types
      .filter(item => item.uid.startsWith('application::'))
      .reduce((map, item) => {
        map[item.uid] = {
          ...item.schema,
          uid: item.uid,
        };
        return map;
      }, {});
    const componentsMap = components.data.data
      .reduce((map, item) => {
        map[item.uid] = {
          ...item.schema,
          uid: item.uid,
        };
        return map;
      }, {});

    const maps = {
      types: typesMap,
      components: componentsMap,
    };

    const typePaths = {};
    const componentPaths = {};
    Object.keys(typesMap).forEach(item => {
      buildRichTextPath(typesMap[item], maps, typePaths, componentPaths);
    });

    const result = {};
    Object.keys(typePaths).forEach(key => {
      // build map with full paths to rich text fields
      const newKey = key.replace(/^application::.*?\./i, '');
      typePaths[key].forEach(path => {
        result[`${newKey}.${path}`] = true;
      });
    });

    return {
      richTextPaths: result,
      types: typePaths,
      components: componentPaths,
    };
  } catch (error) {
    reporter.panic(`Failed to fetch metadata from Strapi`, error);
  }
};

/**
 * Remove fields starting with `_` symbol.
 *
 * @param {object} item - Entry needing clean
 * @returns {object} output - Object cleaned
 */
const clean = (item) => {
  forEach(item, (value, key) => {
    if (key === `__v`) {
      // Remove mongo's __v
      delete item[key];
    } else if (key === `_id`) {
      // Rename mongo's "_id" key to "id".
      delete item[key];
      item.id = value;
    } else if (startsWith(key, '__')) {
      // Gatsby reserves double-underscore prefixes – replace prefix with "strapi"
      delete item[key];
      item[`strapi_${key.slice(2)}`] = value;
    } else if (isObject(value)) {
      item[key] = clean(value);
    }
  });

  return item;
};

const addAuthorizationHeader = (options, token) => {
  if (token) {
    set(options, 'headers.Authorization', `Bearer ${token}`);
  }

  return options;
};

const { Sequelize, DataTypes, Op } = require("sequelize");
const { dbConfig } = require("../config/database");
const utils = new (require("../utils/utils"))(); // Load utilies
const queryLitteral = new (require("../utils/QueryLitteral"))();
const SchemaManager = require("./SchemaManager");
const DotWalking = require("./DotWalking");

// IMPORT MODELS
const SysMetaData = require("../models/SysMetaData");
const SysGlideObject = require("../models/SysGlideObject");
const SysDictionary = require("../models/SysDictionary");
const SysDbObject = require("../models/SysDbObject");
const XmlImport = require("./XmlImport");

const sequelize = new Sequelize(
  dbConfig.database,
  dbConfig.user,
  dbConfig.password,
  {
    host: dbConfig.host,
    dialect: "mariadb",
    logging: false, // utils.warn,
    define: {
      freezeTableName: true, // Prevent Sequelize from pluralizing table names
      createdAt: "sys_created_on",
      updatedAt: "sys_updated_on",
    },
  }
);

class Sequelizer {
  constructor() {
    this.sequelize = sequelize;
    this.sysMetaData = SysMetaData(this.sequelize);
    this.sysGlideObject = SysGlideObject(this.sequelize, this.sysMetaData);
    this.sysDictionary = SysDictionary(this.sequelize, this.sysMetaData);
    this.sysDbObject = SysDbObject(this.sequelize, this.sysMetaData);

    // Dependecy registry
    this.sysDbObject.sysDictionary = this.sysDictionary;
    this.sysDictionary.sysGlideObject = this.sysGlideObject;
    this.sysDictionary.sysDbObject = this.sysDbObject;

    this.xmlImport = new XmlImport(this);


    this.sequelize.sync({ alter: false, force: false });
    // alter : true => Sequelize automatically updates the database schema to match the model definitions without dropping existing tables. It could drop new columns created outside of Sequelize Model (i.e. manually in DBMS)
    // force : true => Drops everything and recreates everything.
    this.schemaManager = new SchemaManager(this.sequelize, this.sysDbObject);
  }

  async testConnection() {
    // Test the connection
    return await this.sequelize
      .authenticate()
      .then(() => {
        return {response : "success"}
      })
      .catch((err) => {
        return {response : "error : " + err};
      });
  }

  // Get a list of tables
  async getTables() {
    return await this.sequelize.getQueryInterface().showAllTables();
  }

  // Get the structure of a table
  async getTableInfo(table_name) {
    return await this.sysDbObject
      .findOne({ where: { name: table_name } })
      .then((result) => {
        return { data: result, status: "success" };
      })
      .catch((e) => {
        console.error("[SEQUELIZE] Get table info error : ", e);
        return { data: {}, status: "fail", err: e };
      });
  }

  // Delete a table from DB
  async dropTable(tableName) {
    return await this.sequelize
      .getQueryInterface()
      .dropTable(tableName)
      .then(() => {
        console.log("Table has been dropped: ", tableName);
        return { status: "success" };
      })
      .catch((error) => {
        console.log("An error occurred: ", error);
        return { status: "fail" };
      });
  }

  async getColumns(table_name) {
    return await this.sequelize.queryInterface
      .describeTable(table_name)
      .then((tableDefinition) => {
        return {table: table_name, data: tableDefinition, status: "success"};
      })
      .catch((e) => {
        console.error("Get columns error : ", e);
        return { table: table_name, data: {}, status: "fail", err: e };
      });
  }

  async getFields(tableName) {
    return await this.sysDictionary
      .getAttribs(tableName)
      .then((rows) => {
        return {table: tableName, data: rows, status: "success"};
      })
      .catch((e) => {
        console.error("[Sequelizer::getFields] Get columns error : ", e);
        return { table: tableName, status: "fail", err: e };
      });
  }

  async getChildFieldNames(tableName, sysparm_fields = "") {
    const requestedFields = String(sysparm_fields || "")
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean);

    const allFields = (await this.sysDictionary.getAttribs(tableName))?.rows || [];
    const childFieldNames = [...new Set(
      allFields
        .filter((field) => field.name === tableName && !field.inherited && field.element)
        .map((field) => field.element)
    )];

    if (!requestedFields.length) return childFieldNames;
    return requestedFields.filter((field) => childFieldNames.includes(field));
  }

  async getParentFieldNames(tableName) {
    const superClass = await this.sysDbObject.getSuperClass(tableName);
    if (!superClass) return [];

    const parentFields = (await this.sysDictionary.getAttribs(superClass))?.rows || [];
    return [...new Set(
      parentFields
        .filter((field) => field.name === superClass && !field.inherited && field.element)
        .map((field) => field.element)
    )];
  }

  async consolidateParentChildRows(tableName, rows = []) {
    if (!Array.isArray(rows) || rows.length === 0) return rows;

    const superClass = await this.sysDbObject.getSuperClass(tableName);
    if (!superClass) return rows;

    const ParentModel = await this.getTableMapping(superClass);
    const sysIds = rows
      .map((row) => row.sys_id ?? row.dataValues?.sys_id)
      .filter(Boolean);

    if (!sysIds.length) return rows;

    const parentRows = await ParentModel.findAll({
      where: { sys_id: sysIds },
      attributes: await this.getParentFieldNames(tableName),
    });

    const parentMap = new Map(
      (parentRows || []).map((row) => {
        const data = row.toJSON ? row.toJSON() : row;
        return [String(data.sys_id), data];
      })
    );

    return rows.map((row) => {
      const child = row.toJSON ? row.toJSON() : row;
      const parent = parentMap.get(String(child.sys_id));
      return parent ? { ...parent, ...child } : child;
    });
  }

  /** RECORD operations
   * @param {Object} req request object must contain table_name in params
   */
  async getTableColumnNames(tableName) {
    try {
      const tableDefinition = await this.sequelize.getQueryInterface().describeTable(tableName);
      return Object.keys(tableDefinition || {});
    } catch (error) {
      return [];
    }
  }

  async sanitizePayloadForTable(tableName, data = {}) {
    const allowedColumns = new Set(await this.getTableColumnNames(tableName));
    const sanitized = {};

    for (const [key, value] of Object.entries(data || {})) {
      if (value === undefined) continue;
      if (allowedColumns.has(key)) {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  async splitParentChildData(tableName, data = {}) {
    const superClass = await this.sysDbObject.getSuperClass(tableName);
    const childTableColumns = await this.getTableColumnNames(tableName);

    if (!superClass) {
      return {
        parentData: { ...data },
        childData: { ...data },
      };
    }

    const parentFields = new Set((await this.getParentFieldNames(tableName)).map((field) => String(field)));
    const childFields = new Set((await this.getChildFieldNames(tableName)).map((field) => String(field)));

    const parentData = {};
    const childData = {};

    for (const [key, value] of Object.entries(data || {})) {
      if (value === undefined) continue;

      const fieldName = String(key);
      const isSystemField = fieldName.startsWith("sys_");
      const childHasColumn = childTableColumns.includes(fieldName);

      if (superClass && isSystemField && !childHasColumn) {
        parentData[key] = value;
        continue;
      }

      if (isSystemField && childHasColumn) {
        parentData[key] = value;
        childData[key] = value;
        continue;
      }

      if (parentFields.has(fieldName) && !childFields.has(fieldName)) {
        parentData[key] = value;
        continue;
      }

      if (childFields.has(fieldName) || (!parentFields.has(fieldName) && !isSystemField)) {
        childData[key] = value;
      }
    }

    if (data.sys_id !== undefined) {
      parentData.sys_id = data.sys_id;
      childData.sys_id = data.sys_id;
    }

    return { parentData, childData };
  }

  async getRows(req) {
    const { table_name } = req.params;
    const { sys_id, sysparm_query, sysparm_limit, sysparm_fields } = req.query;
    
    // Get the appropriate model
    const Model = await this.getTableMapping(table_name);

    if (!sys_id) {
      let query = {};
      if (sysparm_query) {
        const q = queryLitteral.encodedQueryToSequelize(sysparm_query);
        query = { where: q };
        if (parseInt(sysparm_limit)) query.limit = parseInt(sysparm_limit);

        console.log("[Sequlizer::getRows] Filtered Query: %o", query);
      }

      query.attributes = await this.getChildFieldNames(table_name, sysparm_fields);

      return await Model.findAll(query)
        .then(async (result) => {
          const consolidated = await this.consolidateParentChildRows(table_name, result);
          return { data: consolidated, status: "success" };
        })
        .catch((e) => {
          console.error("[Sequlizer::getRows] Get rows error : ", e);
          return { data: [], status: "fail", err: e };
        });
    }

    if (sys_id) return this.findBySysId(Model, sys_id);
  }

  /**
   * Queries the database for a given table name and sys_id to return the configured display value.
   * @param {string} tableName The name of the table to query.
   * @param {string} sys_id The sys_id of the record to retrieve.
   * @param {string} reference_key The key to match the value against.
   * @returns {Promise<Object>} An object containing the display value or an error.
   */
  async getDisplayValueFromSysId(tableName, value, reference_key) {
    try {
      let displayField = await this.sysDictionary.getDisplayField(tableName);
      const hasSysName = await this.sysDictionary.isValidField(tableName, 'sys_name');
      displayField = displayField || (hasSysName ? "sys_name" : "sys_created_on"); // Fallback to sys_created_on if no display field or sys_name exists
      const Model = await this.getTableMapping(tableName);
      const where = { [reference_key || 'sys_id']: value };
      const attributes = [displayField];
      const result = await Model.findOne({ where, attributes });
      if (result)
        return { data: result[displayField], status: 'success' };

      return { data: null, status: 'fail', err: 'Record not found' };
    } catch (e) {
      console.error(`[SEQUELIZER] Error getting display value for table ${tableName}, value ${value}: `, e);
      return { data: null, status: 'fail', err: e.message };
    }
  }

  /**
   * Queries the database for a given table name and sys_id to return the display value.
   * This function is intended to retrieve the display value for a reference key.
   * @param {string} sys_id The sys_id of the record to retrieve.
   * @returns {Promise<Object>} An object containing the display value or an error.
   */
  async getReferenceKeyBySysId(sys_id) {
    let ret = {data: null, status: "fail"};
    try {
      const Model = await this.getTableMapping("sys_dictionary");
      const result = await Model.findByPk(sys_id, {
        attributes: ['reference_key']
      });
      
      if (result)
        ret = { data: result.reference_key, status: "success" };

      return ret;
      
    } catch (e) {
      console.error(`[SEQUELIZER::getReferenceKeyBySysId] Error getting reference key for table "sys_dictionary", sys_id ${sys_id}: `, e);
      return { data: null, status: "fail", err: e.message };
    }
  }

  async findBySysId(Model, sys_id) {
    return await Model.findByPk(sys_id)
      .then((result) => {
        return { data: [result], status: "success", err: "" };
      })
      .catch((e) => {
        console.error("[SEQUELIZER::findBySysId] Get rows error : ", e);
        return { data: "", status: "fail", err: e };
      });
  }

  async handleRecord(req) {
    let { sys_id } = req.query;

    // Debug: log incoming sys_id shapes when unexpected errors occur
    try {
      console.debug("[SEQUELIZER::handleRecord] incoming req.query.sys_id type=%s value=%o", typeof req.query.sys_id, req.query.sys_id);
    } catch (e) {
      // ignore debug errors
    }

    // Normalize cases where sys_id is sent as an object via query string
    if (sys_id && typeof sys_id === "object") {
      // If the nested object contains a scalar sys_id, prefer that
      if (sys_id.sys_id) {
        let scalar = sys_id.sys_id;
        if (Array.isArray(scalar)) scalar = scalar[0];
        if (typeof scalar === 'object') scalar = String(scalar);
        req.body.sys_id = req.body.sys_id || scalar;
        sys_id = scalar;
      } else {
        // Merge any provided query fields into the body (e.g. sys_id[name]=...)
        req.body = { ...sys_id, ...req.body };
        // Coerce any merged sys_id to scalar if present
        let merged = req.body.sys_id || null;
        if (merged && Array.isArray(merged)) merged = merged[0];
        if (merged && typeof merged === 'object') merged = String(merged);
        if (merged) {
          req.body.sys_id = merged;
          sys_id = merged;
        } else {
          // No scalar sys_id found; leave sys_id as undefined so insert path is chosen
          sys_id = req.body.sys_id || undefined;
        }
      }
    } else {
      sys_id = utils.nil(sys_id) ? req.body.sys_id : sys_id; //either from body or query
      if (!utils.nil(sys_id) && !req.body.sys_id) req.body.sys_id = sys_id;
    }

    try {
      console.debug("[SEQUELIZER::handleRecord] normalized sys_id type=%s value=%o", typeof sys_id, sys_id);
    } catch (e) {}

    // if sys_id=-1 then create new record
    if (utils.nil(sys_id) || sys_id === "-1") {
      return await this.insertRow(req);
    } else {
      // Try to update an existing record
      return await this.updateRow(req);
    }
  }

  /**
   *
   * @param {object} req Request object of the api containing table_name in req.params
   * @returns promise
   */
  async insertRow(req) {
    const { table_name } = req.params;
    const superClass = await this.sysDbObject.getSuperClass(table_name);
    const tableFields = await this.getTableColumnNames(table_name);

    req.body.sys_id = req.body.sys_id || utils.generateSysID();

    req.body.sys_created_by = req.body.sys_created_by || "system";
    req.body.sys_updated_by = req.body.sys_updated_by || "system";

    if (tableFields.includes("sys_updated_on")) req.body.sys_updated_on = this.sequelize.fn("NOW");
    if (tableFields.includes("sys_created_on")) req.body.sys_created_on = this.sequelize.fn("NOW");

    const displayField = await this.sysDictionary.findOne({
      where: {
        name: table_name,
        display: true,
      }
    });

    if (tableFields.includes("sys_name")) {
      req.body.sys_name = req.body.sys_name || (displayField ? req.body[displayField.element] : req.body.name);
    }

    if (superClass || tableFields.includes("sys_mod_count")) {
      req.body.sys_mod_count = req.body.sys_mod_count || "0";
    }
    if (tableFields.includes("sys_update_name")) req.body.sys_update_name = `${table_name}_${req.body.sys_id}`;
    if (tableFields.includes("sys_class_name")) req.body.sys_class_name = table_name;

    const { parentData, childData } = await this.splitParentChildData(table_name, req.body);
    const Model = await this.getTableMapping(table_name);

    try {
      if (superClass) {
        const ParentModel = await this.getTableMapping(superClass);
        const validParentData = await this.sanitizePayloadForTable(superClass, parentData);
        if (Object.keys(validParentData).length) {
          await ParentModel.create(validParentData);
        }
      }

      const validChildData = await this.sanitizePayloadForTable(table_name, childData);
      const result = await Model.create(validChildData);
      return { sys_id: result.dataValues.sys_id, status: "success" };
    } catch (e) {
      console.error("[SEQUELIZER::insertRow] Insert row error : ", e);
      return { sys_id: "", status: "fail", err: e };
    }
  }

  async updateRow(req) {
    const { table_name } = req.params;
    const { sys_id } = req.body;
    const superClass = await this.sysDbObject.getSuperClass(table_name);

    const Model = await this.getTableMapping(table_name);
    const instance = await Model.findByPk(sys_id);
    if (!instance)
      return { sys_id: "", status: "fail", err: "Record not found" };

    const childTableColumns = await this.getTableColumnNames(table_name);
    if (childTableColumns.includes("sys_updated_on")) {
      req.body.sys_updated_on = this.sequelize.fn("NOW");
    }
    if (childTableColumns.includes("sys_created_on")) {
      delete req.body.sys_created_on;
    }

    const { parentData, childData } = await this.splitParentChildData(table_name, req.body);

    try {
      if (superClass) {
        const ParentModel = await this.getTableMapping(superClass);
        const validParentData = await this.sanitizePayloadForTable(superClass, parentData);
        if (Object.keys(validParentData).length) {
          await ParentModel.update(validParentData, {
            where: { sys_id },
            individualHooks: true,
          });
        }
      }

      const validChildData = await this.sanitizePayloadForTable(table_name, childData);
      await Model.update(validChildData, {
        where: { sys_id },
        individualHooks: true,
      });

      return { sys_id: sys_id, status: "success" };
    } catch (e) {
      console.error("[SEQUELIZER::updateRow] Update row error : ", e);
      return { sys_id: sys_id, status: "fail", err: e };
    }
  }

  async deleteRow(req) {
    const { table_name } = req.params;
    const record = req.query; // needs sanitization to prevent SQL / HTML injection
    // const t = await this.sequelize.transaction();
    try {
      await this._parentCascadeDelete(table_name, record, {});
      // await t.commit();
      return { record, status: "success" };
    } catch (e) {
      // await t.rollback();
      console.error("[SEQUELIZER::deleteRow] %s - Delete row error : %s", table_name, e);
      return { record, status: "fail", err: e };
    }   
  }

  /**
 * Recursively deletes a record up the super_class chain.
 * Works for both named models (sys_db_object, sys_dictionary)
 * and dynamic/generic models (incident, task, etc.)
 *
 * @param {string} table_name - current table to delete from
 * @param {string} record - the record to delete
 * @param {Transaction} t - shared transaction
 */
async _parentCascadeDelete(table_name, record, t) {
  const Model = await this.getTableMapping(table_name);
  await Model.destroy({
    where: record, // in case of sys_dictionary or sys_db_object, otherwise sys_id is sufficient
    individualHooks: true,
    // transaction: t,
  }).then(() => {
    console.log("[SEQUELIZER::_parentCascadeDelete] %s - Records deleted : %o\n", table_name, record.length);
    return { record, status: "success" };
  })
  .catch((e) => {
    console.error("[SEQUELIZER::_parentCascadeDelete] %s - Delete error : %s", table_name, e);
    throw e; // Rethrow the error to be handled by the caller
  });

  const superClass = await this.sysDbObject.getSuperClass(table_name);
  // Recurse up if parent exists
  if (superClass)
    await this._parentCascadeDelete(superClass, record, t);
}

async getTableMapping(tableName) {
  const table_map = {
    sys_db_object: this.sysDbObject,
    sys_dictionary: this.sysDictionary,
    sys_metadata: this.sysMetaData,
  };

  let Model = table_map[tableName];
    if (!Model) {
    // Dynamically define the model if it doesn't exist in the table_map
    const { data } = await this.getColumns(tableName);
    const columns = data || {};
    const hasSysCreated = Object.prototype.hasOwnProperty.call(columns, "sys_created_on");
    const hasSysUpdated = Object.prototype.hasOwnProperty.call(columns, "sys_updated_on");
    const useTimestamps = hasSysCreated && hasSysUpdated;

    Model = this.sequelize.define(tableName, columns, {
      tableName: tableName,
      modelName: tableName,
      freezeTableName: true,
      timestamps: useTimestamps,
      createdAt: useTimestamps ? "sys_created_on" : false,
      updatedAt: useTimestamps ? "sys_updated_on" : false,
    });
  }

  return Model;
}
///////
  addHooks(Model, operation, records) {
    switch (operation) {
      case "create":
        Model.addHook("beforeCreate", (model, options) => {
          // TODO : add before business rules
        });
        Model.addHook("afterCreate", (model, options) => {
          // TODO : add after business rules
        });
        break;
      case "update":
        log(warning("inside addhooks : %s"), Model.getTableName());
        Model.addHook("beforeUpdate", (model, options) => {
          // TODO : add before business rules
          log(warning("Running beforeupdate hook for table : %s, %o"), Model.getTableName(), options);
        });
        Model.addHook("afterUpdate", (model, options) => {
          // TODO : add after business rules
          log(warning("Running afterupdate hook for table : %s"), model.get("sys_class_name"));
        });
        break;
      case "delete":
        Model.addHook("beforeDestroy", (model, options) => {
          // TODO : add before business rules
          log(warning("Running beforeDestroy hook for table : %s"), model.get("sys_class_name"));
        });
        Model.addHook("afterDestroy", (model, options) => {
          // TODO : add after business rules
          log(warning("Running afterDestroy hook for table : %o, %o"), model, options);
        });
        break;
      case "bulkDelete":
        Model.addHook("beforeBulkDestroy", (model, options) => {
          // TODO : add before business rules
          // log(warning("Running beforeBulkDestroy hook for table : %o"), model);
        });
        Model.addHook("afterBulkDestroy", async (model, options) => {
          // TODO : add after business rules
          log(warning("Running afterBulkDestroy hook for table : %s"), record.sys_class_name);
          // const record = records.pop();
        //   if (record.sys_class_name === "sys_dictionary")
        //     this.removeColumn(record.sys_class_name, record.name); // CHECK THIS TO SEE IF IT IS DUPLICATE WITH SYS_DB_OBJECT
        });
        break;
      default:
        break;
    }
  }
}

module.exports = Sequelizer;
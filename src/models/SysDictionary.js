// Import Sequelize and Model
const { DataTypes, Model, Op } = require("sequelize");

// IMPORT SysMetaData Model class
const Utils = require("../utils/utils");
const utils = new Utils();

module.exports = (sequelize, parent) => {
  
  class SysDictionary extends Model {
    static table_name = "sys_dictionary";
    static attr = {
      ...parent.attr,
      element: DataTypes.STRING(80),
      column_label: DataTypes.STRING(80),
      internal_type: DataTypes.STRING(32),
      name: DataTypes.STRING(80),
      reference: DataTypes.STRING(32),
      reference_key: DataTypes.STRING(40),
      default_value: DataTypes.STRING(80),
      max_length: DataTypes.INTEGER(6),
      attrributes: DataTypes.STRING(1000),
      active: DataTypes.BOOLEAN,
      display: DataTypes.BOOLEAN,
      mandatory: DataTypes.BOOLEAN,
      unique: DataTypes.BOOLEAN,
    };
        
    static INTERNAL_COLLECION_TYPE = "collection";

    /**
     * create a new column in the specified table in DB
     * @param {Model} sysDictionary sys_dictionary Sequelize model object
     * @returns Object {status : "success | fail"}
     */
    static async _createColumn(sysDictionary, options = {}) {
      const { name, element, max_length, internal_type, default_value, mandatory } = sysDictionary;
      const queryInterface = sequelize.getQueryInterface();
      const type = this.sysGlideObject.customDataTypes[internal_type](max_length);

      try {
        const tableDefinition = await queryInterface.describeTable(name);
        if (tableDefinition[element]) {
          console.log("[SysDictionary::_createColumn] Column already exists, skipping: ", element);
          return { status: "success" };
        }
        return queryInterface
          .addColumn(name, element, {
            type: type,
            defaultValue: utils.nil(default_value)
              ? false
              : utils.bool(default_value),
            allowNull: mandatory ? false : true, // if manadatory set to false !
          })
          .then(() => {
            console.log("[SysDictionary::_createColumn] New column added: ", element);
            return { status: "success" };
          });
      } catch (error) {
        console.error("[SysDictionary::_createColumn] Exception occurred: ", error);
        throw error;
      }
    }

    /**
     *
     * @param {Model} sysDictionary sys_dictionary Sequelize model object
     * @returns Object {status : "success | fail"}
     */
    static async updateColumn(sysDictionary, options = {}) {
      if (utils.nil(sysDictionary)) return;

      const { sys_id, name, element, max_length, unique, default_value, internal_type } = sysDictionary;

      const instance = await SysDictionary.findByPk(sys_id);
      if (!instance) return { status: "fail", err: "Record not found" };

      // Retrieve the actual type name from SysGlideObject using the internal_type sys_id
      const internalTypeName = await this.sysGlideObject.getGlideObjectNameBySysId(internal_type);
      const type = this.sysGlideObject.customDataTypes[internalTypeName](max_length);

      return sequelize
        .getQueryInterface()
        .changeColumn(name, element, {
          type: type,
          unique: unique,
          defaultValue: utils.nil(default_value)
            ? false
            : utils.bool(default_value),
        })
        .then(() => {
          console.log("[SysDictionary::updateColumn] New column added: ", element);
          return { status: "success" };
        })
        .catch((error) => {
          console.error("[SysDictionary::updateColumn] An error occurred: ", error);
          throw error;
        });
    }

    /**
     *
     * @param {string} tableName name of the table to delete column from
     * @param {string} columnName name of column to delete
     * @returns {object} {table, column, status: success | fail, err}
     */
    static async deleteColumn(tableName, columnName, options = {}) {

      return sequelize
        .getQueryInterface()
        .removeColumn(tableName, columnName)
        .then((result) => {
          console.log("[SysDictionary::deleteColumn] Column deleted : ", result);
          return {table: tableName, column: columnName, status: "success", err: "", };
        })
        .catch((e) => {
          console.error("[SysDictionary::deleteColumn] Delete Column error : ", e);
          return {table: tableName, column: columnName, status: "fail", err: e, };
        });
    }

    /**
     * find a record using its sys_id
     * @param {string} sysID unique id of the record to look for
     * @returns {object}
     */
    static async findBySysId(sysID) {
      return await this.findByPk(sysID)
        .then((result) => {
          var r = !result ? [] : result;
          return { data: r, status: "success", err: "" };
        })
        .catch((e) => {
          console.error("[SysDictionary::findBySysId] Error : ", e);
          return { data: "", status: "fail", err: e };
        });
    }

    /**
     * get all rows for given options
     * @param {object} options sequelize options or query
     * @returns {promises} array of object records or error
     */
    static async getRows(options) {
      try {
        if (utils.bool(options.no_count)) {
          return await this.findAll(options)
            .then((records) => {
              return {rows: records, count: records.length};
            });
        }
        return await this.findAndCountAll(options)
          .then((records) => {
            return records;
          });
      } catch (e) {
        console.error("[SysDictionary::getRows] Exception occurred: ", e);
        throw e;
      }
    }

    /**
     * Get the dictionary record that is marked as display=true for a given table.
     * @param {string} tableName - The table name to lookup.
     * @returns {Promise<Model|null>} The display field record, or null if none found.
     */
    static async getDisplayField(tableName) {
      try {
        const displayField = await this.findOne({
          where: {
            name: tableName,
            display: true,
          },
        });

        if (displayField) {
          return displayField.element;
        }

        const superClass = await this.sysDbObject.getSuperClass(tableName);
        if (superClass)
          return await this.getDisplayField(superClass); // Recursively check the super_class for a display field

        return null;
      } catch (error) {
        console.error(`[SysDictionary::getDisplayField] Error querying display field for ${tableName}:`, error);
        return null;
      }
    }

  /**
   * Check if a column exists in a given table by querying sys_dictionary.
   * @param {string} tableName - The table name to lookup.
   * @param {string} columnName - The column name to check.
   * @returns {Promise<boolean>} True if the column exists, false otherwise.
   */
  static async isValidField(tableName, columnName) {
    try {
      const field = await this.findOne({
        where: {
          name: tableName,
          element: columnName,
        },
        attributes: ['element'], // lightweight — only fetch what we need
      });

      if(field)
        return true;

      const superClass = await this.sysDbObject.getSuperClass(tableName);
      if (superClass)
        return await this.isValidField(superClass, columnName); // Recursively check the super_class for a display field

      return false;

    } catch (error) {
      console.error(`[SysDictionary::isValidField] Error checking field ${columnName} on ${tableName}:`, error);
      return false;
    }
  }

    // TODO : Methods : delete row, MultipleDelete rows

    /**
     * Retrieve attribute definitions for a given table.
     *
     * This method returns all dictionary records for the requested table and,
     * if the table has a superclass, also returns inherited attribute records
     * from that superclass. Collection-type internal records are excluded.
     *
     * @param {string} tableName - The name of the table to retrieve attributes for.
     * @returns {Promise<{rows: Array<object>}>} An object containing the rows of attribute definitions.
     */
    static async getAttribs(tableName) {
      // First get records for the given table
      const tableRecords = await this.getRows({
        where: { name: tableName, internal_type: { [Op.ne]: this.INTERNAL_COLLECION_TYPE } },
        no_count: true
      });      

      // Get the super_class using SysDbObject
      const superClass = await this.sysDbObject.getSuperClass(tableName);      

      if (!superClass) {
        // If no super_class, return just the table records
        return {
          rows: tableRecords.rows.map((r) => r.dataValues)
        };
      }

      // Get super_class table records
      const superClassRecords = await this.getRows({
        where: { name: superClass, internal_type: { [Op.ne]: this.INTERNAL_COLLECION_TYPE } },
        no_count: true
      });

      // Combine and return both sets of records.
      // Exclude inherited sys_id field from superclass rows and omit the superclass sys_id value.
      return {
        rows: [
          ...tableRecords.rows.map((r) => r.dataValues),
          ...superClassRecords.rows
            .filter((r) => r.dataValues.element !== "sys_id")
            .map((r) => ({ ...r.dataValues, inherited: true }))
        ]
      };
    }

    /**
     * Create columns in child tables without inserting dictionary records
     * Only creates the physical column at DB level
     * @param {string} parentTableName - The name of the parent table
     * @param {Object} columnData - The column data (element, internal_type, max_length, default_value, mandatory)
     * @returns {Promise<void>}
     */
    static async _createColumnsInChildTables(parentTableName, columnData, options = {}) {
      const childTables = await this.sysDbObject.getChildTables(parentTableName, options);
      for (const childTable of childTables) {
        const childColumnData = {
          ...columnData,
          name: childTable
        };
        await this._createColumn(childColumnData, options);
      }
    }

    // overload the `create` method
    static async create(data, options) {
      // Only set sys_name if it hasn't been set already (for non-collection records)
      if (data.internal_type != this.INTERNAL_COLLECION_TYPE){
        data.sys_name = data.column_label;
        data.sys_update_name = `${this.table_name}_${data.name}_${data.element}`;
      }
      data.sys_class_name = this.table_name;

      try {
        // ignore if type is collection
        if (data.internal_type != this.INTERNAL_COLLECION_TYPE) {
          this._createColumn(data, options); // Create the column in DB
          // Create columns in child tables (DB level only, no dictionary records)
          await this._createColumnsInChildTables(data.name, data, options);
        }

        await parent.create(data, options); // Create a new record in sys_metadata
        // Insert the new row in table
        const record = await super.create(data, options);
        return record;
      } catch (e) {
        console.error("[SysDictionary::create] Error : ", e);
        throw e; // Rethrow the error to be handled by the caller
      }
    }

    // overload the `destroy` method
    static async destroy(data, options) {
      const { sys_id, name, element } = data.where;

      try {
        // Delete the column at DB level first before deleting the record in sys_dictionary
        await this.deleteColumn(name, element);

        // Then delete the record in sys_dictionary which will cascade delete the record in sys_metadata due to the association and cascade delete setup in sequlizer
        const record = await super.destroy({ where: { sys_id } }, options)
          .then((result) => {
            return { sys_id, status: "success" };
          });
      } catch (e) {
        console.error("[SysDictionary::destroy] Exception occurred: %s", e);
        throw e; // Rethrow the error to be handled by the caller
      }
    }

    async updateRow(data) {
      // log(warning("sysDictionary - inside update row :  %o"), data);
      const instance = await this.findByPk(data.sys_id);
      if (!instance)
        return { sys_id: "", status: "fail", err: "Record not found" };

      data.sys_updated_on = this.sequelize.fn("NOW");
      delete req.body.sys_created_on;

      return await instance
        .update(data, {where: {sys_id: data.sys_id,}, individualHooks: true,})
        .then(() => {
          return { sys_id: data.sys_id, status: "success", err: "" };
        })
        .catch((e) => {
          console.error("[SysDictionary::updateRow] error : ", e);
          return { sys_id: sys_id, status: "fail", err: e };
        });
    }

    static async createCollection(data, options) {
      // unique 32-character sys_id
      // To prevent duplicate sys_id need a new sys_id for the collection record for each table creation.
      data.sys_id = utils.generateSysID();
      data.internal_type = this.INTERNAL_COLLECION_TYPE;
      data.sys_update_name = `${this.table_name}_${data.name}`;
      data.sys_name = data.name;

      // Only create the collection record, parent fields are copied by SysDbObject.create
      return await this.create(data, options);
    }
    
    static async deleteCollection(data, options) {
      try {
        const tableName = data.where.name;
        // Find all dictionary records for this table (collection and fields)
        const allRecords = await super.findAll({where: {name: tableName}});

        if (!allRecords || allRecords.length === 0) {
          console.warn("[SysDictionary::deleteCollection] No records found for:", tableName);
          return;
        }

        // Get the collection record
        const collection = allRecords.find(record => record.internal_type === 'collection');
        if (!collection) {
          console.warn("[SysDictionary::deleteCollection] No collection record found for:", tableName);
          return;
        }

        // Get all sys_ids to delete from sys_metadata
        const sysIdsToDelete = allRecords.map(record => record.sys_id);

        try {
          // Delete corresponding records in sys_metadata first
          const deletedMetadata = await parent.destroy({where: {sys_id: { [Op.in]: sysIdsToDelete }}}, options);
        } catch (error) {
          console.error("[SysDictionary::deleteCollection] Error deleting sys_metadata records:", error);
          throw error;
        }

        // Delete all field records for this table excluding the collection record itself
        try {
          const deletedFields = await super.destroy({where: {name: tableName, sys_id: { [Op.ne]: collection.sys_id }}}, options);
        } catch (error) {
          console.error("[SysDictionary::deleteCollection] Error deleting field records:", error);
          throw error;
        }

        // Delete the collection record itself
        try {
          await super.destroy({where: {sys_id: collection.sys_id}}, options);
        } catch (error) {
          console.error("[SysDictionary::deleteCollection] Error deleting collection record:", error);
          throw error;
        }

      } catch (e) {
        console.error("[SysDictionary::deleteCollection] error:", e);
        throw e; // Rethrow the error to be handled by the caller
      }
    }

    /**
     * Get all non-internal collection and non-system fields for a given table name
     * @param {string} superClassName - The name of the super_class table.
     * @returns {Promise<Array>} - Array of matching records.
     * @private
     */
    static async _getSuperClassFields(superClassName) {
      if (!superClassName) return [];
      
      return await this.findAll({
        where: {
          name: superClassName,
          internal_type: { [Op.ne]: this.INTERNAL_COLLECION_TYPE },
          element: {
            [Op.notLike]: 'sys_%'  // Exclude system fields
          }
        }
      }) || [];
    }

    /**
     * Get all base system fields for a table
     * @returns {Promise<Array>} - Array of records with base system fields
     * @private
     */
    static async _getBaseSystemFields() {
      const baseFields = [
        "sys_updated_by",
        "sys_updated_on",
        "sys_created_on",
        "sys_created_by",
        "sys_mod_count",
        "sys_id"
      ];

      // Group by element to get unique records
      return await this.findAll({where: {element: {[Op.in]: baseFields}}, group: ['element'],}) || [];
    }

    /**
     * Copy all fields from a super_class table to a new table in sys_dictionary.
     * In abscence of super_class fields, copy base system fields instead.
     * @param {string} tableName - The name of the new table.
     * @param {string} superClassName - The name of the super_class table.
     * @returns {Promise<Array>} - Array of created records.
     */
    static async _copyParentFields(tableName, superClassName) {
      if (!tableName) {
        console.error("[SysDictionary::_copyParentFields] Missing tableName");
        return;
      }

      // Get all fields from parent
      const parentFields = await this._getSuperClassFields(superClassName);
      
      // If no parent fields found, get base system fields instead
      const fieldsToProcess = (parentFields && parentFields.length > 0) 
        ? parentFields 
        : await this._getBaseSystemFields();

      // Copy each field, changing the name to the new table
      for (const field of fieldsToProcess) {
        const data = { ...field.dataValues };
        // Set the new table name
        data.name = tableName;
        // Generate a new sys_id for the new record
        data.sys_id = utils.generateSysID();
        // Set audit fields for the new record
        data.sys_created_on = data.sys_updated_on = this.sequelize.fn("NOW");
        data.sys_created_by = data.sys_updated_by = "system"; // must replace with current user
        data.sys_mod_count = 0; // Reset modification count
        data.update_name = `${this.table_name}_${data.name}_${data.element}`;
        await this.create(data);
      }
    }
  }

  // Initialize the SysDictionary class by calling the init method
  SysDictionary.init(SysDictionary.attr, {
    // Specify the sequelize instance and the table name
    sequelize,
    modelName: SysDictionary.table_name,
    tableName: SysDictionary.table_name,
    hooks: {
      beforeCreate: (SysDictionaryModel, options) => {
        // Do something before creating a new SysDictionary instance
        console.log("\n\n[%s] BEFORE CREATE HOOK \n\n", SysDictionary.table_name);
      },
      afterCreate: (SysDictionaryModel, options) => {
        // Do something after creating a new SysDictionary instance
        console.log("\n\n[%s] AFTER CREATE HOOK \n\n", SysDictionary.table_name);
        // Create an application file (sys_metadata)
      },
      beforeUpdate: (SysDictionaryModel, options) => {
        // Do something before updating a SysDictionary instance
        console.log("\n\n[%s] BEFORE UPDATE HOOK \n\n", SysDictionary.table_name);
      },
      afterUpdate: (SysDictionaryModel, options) => {
        // Do something after updating a SysDictionary instance
        console.log("\n\n[%s] AFTER UPDATE HOOK \n\n", SysDictionary.table_name);
        // TODO : Update column length or type
      },
      beforeBulkDestroy: (SysDictionaryModel) => {
        // Do something before destroying a SysDictionary instance
        console.log("\n\n[%s] BEFORE BULK DESTROY HOOK \n\n", SysDictionary.table_name);
      },
      afterBulkDestroy: (options) => {
        // Do something after destroying a SysDictionary instance
        console.log("\n\n[%s] AFTER BULK DESTROY HOOK \n\n", SysDictionary.table_name);
      },
    },
  });

  return SysDictionary;
};

// Import Sequelize and Model
const { DataTypes, Model } = require("sequelize");

/**
 * BaseModel class that extends Sequelize Model
 * Defines the base attributes that all tables will inherit
 */
module.exports = () => {
  
  class BaseModel extends Model {
    // Define base attributes that all models will inherit
    static attr = {
      sys_id: {
        type: DataTypes.UUID,
        primaryKey: true,
        unique: true,
        allowNull: false,
      },
      sys_created_by: {
        type: DataTypes.STRING(40),
        defaultValue: 'system',
        allowNull: false
      },
      sys_updated_by: {
        type: DataTypes.STRING(40),
        defaultValue: 'system',
        allowNull: false
      },
      sys_created_on: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
      },
      sys_updated_on: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
      },
      sys_mod_count: {
        type: DataTypes.STRING(6),
        allowNull: false,
        defaultValue: "0",
      },
      sys_class_name: {
        type: DataTypes.STRING(80),
        allowNull: false,
      },
    };

    /**
     * Get the base attributes for table creation
     * This is used when creating new tables
     * @returns {Object} The base model attributes
     */
    static getAttributes() {
      return this.attr;
    }
  }

  return BaseModel;
};
